// İki sağlayıcı: Google Gemini ve Groq (OpenAI uyumlu).
// Her ikisi de ücretsiz tier sunar:
//   - Gemini : aistudio.google.com/app/apikey  (1500 RPD, bazı bölgelerde dar)
//   - Groq   : console.groq.com/keys           (14400 RPD, Llama 3.3 70B, çok hızlı)

// ── Ortak yardımcılar ──────────────────────────────────────────────────────
function buildBatchPrompt({ businessContext, keywords, items }) {
  const ctx = String(businessContext || '').trim() || 'Genel ihale takibi';
  const kw = (keywords || []).slice(0, 30).join(', ');
  return [
    'Sen, Türk kamu ihaleleri arasında bir firmanın gerçekten teklif verebileceği işleri seçen bir filtre uzmanısın.',
    'FİRMANIN iş tanımını sıkı sıkıya uygula. Kararında tutarlı ol — aynı başlık her zaman aynı sonucu almalı.',
    '',
    '═══ FİRMA PROFİLİ (BU METNE UY) ═══',
    ctx,
    '',
    `FİRMA İLGİ ALANI ANAHTAR KELİMELERİ: ${kw || '(belirtilmedi)'}`,
    '',
    '═══ KARAR KURALLARI ═══',
    '1. FİRMA PROFİLİ\'nde adı geçen ürün/hizmet ya da onunla doğrudan ilgili mal/hizmet → relevant=TRUE',
    '2. FİRMA PROFİLİ\'nde "alakasız" diye listelenen kategoriler veya bunlardan olan ihaleler → relevant=FALSE',
    '3. Başlık net belirsizse (ör. "Muhtelif Elektrik Malzemesi") FİRMA PROFİLİ\'ne uyma ihtimali varsa TRUE (confidence 0.5-0.7)',
    '4. Sadece başlığın baskın konusuna bak — yan kelimelerin varlığı yanıltmasın.',
    '',
    '═══ POZİTİF ÖRNEKLER (ELEKTRİK OTOMASYONU / SCADA / PANO FİRMASI İÇİN) ═══',
    '"SCADA Yazılım Güncelleme İşi" → TRUE (1.0) — doğrudan SCADA',
    '"Koruma Rölesi Alımı" → TRUE (1.0) — sekonder koruma',
    '"Uzak Terminal Birimi (RTU) Alım İşi" → TRUE (1.0) — RTU',
    '"OG Modüler Hücre Tedariki" → TRUE (1.0) — OG pano',
    '"36 kV Kesici Alımı" → TRUE (0.9) — OG anahtarlama',
    '"Kontrol Panosu İmalat ve Montajı" → TRUE (1.0)',
    '"Trafo Merkezi SCADA Entegrasyonu" → TRUE (1.0)',
    '"RMU (Ring Main Unit) Alım İşi" → TRUE (1.0)',
    '"Koruma Röleleri Test ve Devreye Alma" → TRUE (0.9)',
    '"Ölçü Transformatörü Alımı (Akım/Gerilim)" → TRUE (0.85)',
    '"Muhtelif Elektrik Malzemesi Alımı" → TRUE (0.6) — SCADA/pano kapsam olabilir, düşük güven',
    '"TEDAŞ Uzaktan İzleme Sistemi" → TRUE (1.0)',
    '"Fiber Optik Haberleşme Altyapısı" → TRUE (0.7) — SCADA haberleşmesi olabilir',
    '',
    '═══ NEGATİF ÖRNEKLER ═══',
    '"Koruyucu Giyim Donanım Malzemesi" → FALSE — giyim',
    '"Yemek / Kahvaltılık Alımı" → FALSE — gıda',
    '"İlaç Alımı" → FALSE — eczane/sağlık',
    '"Belediye Hizmet Binası Yapım İşi" → FALSE — inşaat',
    '"Zemin Kaplama Döşemesi" → FALSE — inşaat',
    '"Asfalt / Yol Yapım İşi" → FALSE — yol',
    '"Yakıt (Motorin) Alımı" → FALSE — akaryakıt',
    '"Araç Kiralama Hizmeti" → FALSE — taşıma',
    '"Yolcu Taşıma Hizmeti" → FALSE — ulaşım',
    '"Network/Bilgisayar/Yedekleme Cihazları" → FALSE — IT altyapı (SCADA değil)',
    '"Sayaç Alımı" → FALSE — ölçü sayacı (gerilim/akım trafosu değil, su/elektrik tüketim sayacı)',
    '"Termal Kamera Sistemi (Tarım)" → FALSE — tarımsal uygulama',
    '"İlaçlama Makinesi" → FALSE — vektör mücadelesi',
    '"Personel Çalıştırılmasına Dayalı Hizmet" → FALSE — personel',
    '',
    '═══ DEĞERLENDİRİLECEK İHALE LİSTESİ ═══',
    ...items.map((it) => `[${it.idx}] ${it.title || '(yok)'}  |  İdare: ${it.authority || '-'}  |  Tür: ${it.type || '-'}  |  Şehir: ${it.city || '-'}`),
    '',
    '═══ ÇIKTI ═══',
    'YALNIZCA aşağıdaki ham JSON nesnesini döndür. Açıklama metni, "Here is...", markdown fence YOK.',
    '{ "results": [ { "idx": 0, "relevant": true, "confidence": 0.0..1.0, "reason": "kısa Türkçe gerekçe" }, ... ] }',
    'Listedeki her ihale için BİR sonuç döndürmen şart — idx atlama, eksik bırakma.',
  ].join('\n');
}

function buildPrompt({ tender, businessContext, keywords }) {
  const t = tender || {};
  const ctx = String(businessContext || '').trim() || 'Genel ihale takibi';
  const kw = (keywords || []).slice(0, 30).join(', ');

  return [
    'GÖREV: Bir Türk şirketinin kamu ihalelerini filtreleyen titiz bir analistsin.',
    'Karar verirken: ihale başlığı + idare + tür birleşimine bütünsel bak. Tutarlı ol — aynı tür ihaleye her seferinde aynı kararı ver. Tahmin değil, kanıta dayalı karar.',
    '',
    '═══ FİRMA PROFİLİ ═══',
    ctx,
    '',
    `İLGİLİ ANAHTAR KELİMELER (sektörü çağrıştırır, ama tek başına yeterli değildir):`,
    kw || '(belirtilmedi)',
    '',
    '═══ DEĞERLENDİRİLECEK İHALE ═══',
    `Başlık : ${t.name || '(yok)'}`,
    `İdare  : ${t.authority || '(yok)'}`,
    `Şehir  : ${t.province || '(yok)'}`,
    `Tür    : ${t.type?.description || '(yok)'}`,
    `IKN    : ${t.ikn || '(yok)'}`,
    '',
    '═══ KARAR KURALLARI ═══',
    '1. Başlıkta bir anahtar kelime geçiyor diye otomatik "alakalı" deme. Kontekst kritik.',
    '2. İhalenin ana konusunun firmanın iş alanına denk gelmesi gerekir. "Yan ürün/aksesuar" ihaleleri reddet.',
    '3. Şüpheliyse "false" tarafına eğil (false negative > false positive).',
    '4. Aynı kavramı her seferinde aynı şekilde değerlendir — kararlarında tutarlı ol.',
    '',
    '═══ ÖRNEKLER (Elektrik dağıtım/SCADA firması için) ═══',
    'BAŞLIK → KARAR | SEBEP',
    '"OG Pano Alımı" → TRUE | doğrudan iş alanı',
    '"Modüler Hücre Tedariki" → TRUE | OG/AG ekipman',
    '"SCADA Otomasyon Sistemi" → TRUE | doğrudan iş alanı',
    '"Trafo Bakımı ve Yenileme" → TRUE | trafo işi',
    '"Belediye Hizmet Binası Yapım İşi" → FALSE | inşaat işi, alakasız',
    '"Koruyucu Giyim ve Donanım Malzemesi Alımı" → FALSE | giyim, alakasız',
    '"İnşaat Malzemesi Alım İşi" → FALSE | inşaat, alakasız',
    '"Zemin Kaplama Döşemesi" → FALSE | yapı işi',
    '"Personel Çalıştırılmasına Dayalı Hizmet Alımı" → FALSE | hizmet/personel',
    '"Güneş Enerjisi Santrali (GES) Projesi Tasarımı" → TRUE | enerji altyapı, scada/pano içerebilir',
    '"Yemek Hizmeti Alımı" → FALSE | catering',
    '"Bilgisayar/Yazılım Alımı" → FALSE | IT, alakasız',
    '"Tavuk/Süt Ürünleri Alımı" → FALSE | gıda',
    '',
    '═══ ÇIKTI ═══',
    'YALNIZCA aşağıdaki şemada ham JSON döndür. Açıklama metni, "Here is...", markdown code fence (```) YOK.',
    '{ "relevant": boolean, "confidence": 0..1, "reason": "kısa Türkçe gerekçe" }',
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}

function tagError(err, status) {
  err.status = status;
  if (status === 429) err.code = 'RATE_LIMIT';
  if (status === 401 || status === 403) err.code = 'AUTH';
  if (status === 404) err.code = 'MODEL_NOT_FOUND';
  return err;
}

const SAMPLE = {
  tender: { name: 'OG Pano Alımı', authority: 'Test Belediyesi', province: 'ANKARA', type: { description: 'Mal' } },
  businessContext: 'Elektrik dağıtım için OG/AG pano üreticisi',
  keywords: ['og pano', 'scada', 'trafo'],
};

// ── Google Gemini sağlayıcısı ──────────────────────────────────────────────
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['relevant', 'reason'],
};

const gemini = {
  async listModels({ apiKey }) {
    if (!apiKey) throw new Error('API anahtarı gerekli');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw tagError(new Error(`Model listesi alınamadı (${res.status})`), res.status);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({
        name: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || m.name,
        inputTokenLimit: m.inputTokenLimit,
      }))
      .filter((m) => /^gemini-/i.test(m.name) && !/embedding|aqa|imagen|veo/i.test(m.name))
      .sort((a, b) => {
        const score = (n) =>
          (/flash-lite/i.test(n) ? 1 : /flash/i.test(n) ? 2 : 3) * 100 -
          parseFloat((n.match(/(\d+\.\d+)/) || [0, 0])[1] || 0);
        return score(a.name) - score(b.name);
      });
  },

  async classify({ tender, businessContext, keywords, apiKey, model }) {
    if (!apiKey) throw new Error('Gemini API anahtarı yok');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.0-flash-lite')}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: buildPrompt({ tender, businessContext, keywords }) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 256,
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw tagError(new Error(`Gemini ${res.status}: ${txt.slice(0, 240)}`), res.status);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const parsed = extractJson(text);
    if (!parsed) throw new Error('Gemini yanıtı JSON olarak ayrıştırılamadı: ' + text.slice(0, 200));
    return {
      relevant: !!parsed.relevant,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      reason: String(parsed.reason || '').slice(0, 240),
    };
  },

  async test({ apiKey, model }) {
    return gemini.classify({ ...SAMPLE, apiKey, model });
  },

  async classifyBatch({ tenders, businessContext, keywords, apiKey, model }) {
    if (!apiKey) throw new Error('Gemini API anahtarı yok');
    const items = tenders.map((t, i) => ({
      idx: i,
      title: t.name || '',
      authority: t.authority || '',
      city: t.province || '',
      type: t.type?.description || '',
    }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.0-flash-lite')}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: buildBatchPrompt({ businessContext, keywords, items }) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw tagError(new Error(`Gemini ${res.status}: ${txt.slice(0, 240)}`), res.status);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.results)) {
      throw new Error('Gemini batch yanıtı ayrıştırılamadı: ' + text.slice(0, 200));
    }
    return parsed.results;
  },
};

// ── Groq sağlayıcısı (OpenAI uyumlu) ───────────────────────────────────────
// Tier-1 ücretsiz: Llama 3.3 70B, 30 RPM, 14400 RPD, kart gerekmez
const groq = {
  async listModels({ apiKey }) {
    if (!apiKey) throw new Error('API anahtarı gerekli');
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw tagError(new Error(`Model listesi alınamadı (${res.status})`), res.status);
    const data = await res.json();
    const models = Array.isArray(data.data) ? data.data : [];
    return models
      .filter((m) => m.active !== false)
      // Klasifikasyon için instruction-tuned text modelleri
      .filter((m) => !/whisper|tts|guard|prompt-guard|granite-vision|playai/i.test(m.id || ''))
      .map((m) => ({
        name: m.id,
        displayName: m.id,
        inputTokenLimit: m.context_window || null,
      }))
      .sort((a, b) => {
        // Llama 3.3 70B, 8b-instant, gemma2 önce
        const w = (n) => (/llama-3\.3-70b/.test(n) ? 1 : /llama.*8b.*instant/.test(n) ? 2 : /gemma2/.test(n) ? 3 : 4);
        return w(a.name) - w(b.name);
      });
  },

  async classify({ tender, businessContext, keywords, apiKey, model }) {
    if (!apiKey) throw new Error('Groq API anahtarı yok');
    const body = {
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir analistsin. Açıklama yazma.' },
        { role: 'user', content: buildPrompt({ tender, businessContext, keywords }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 256,
    };
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw tagError(new Error(`Groq ${res.status}: ${txt.slice(0, 240)}`), res.status);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text);
    if (!parsed) throw new Error('Groq yanıtı JSON olarak ayrıştırılamadı: ' + text.slice(0, 200));
    return {
      relevant: !!parsed.relevant,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      reason: String(parsed.reason || '').slice(0, 240),
    };
  },

  async test({ apiKey, model }) {
    return groq.classify({ ...SAMPLE, apiKey, model });
  },

  async classifyBatch({ tenders, businessContext, keywords, apiKey, model }) {
    if (!apiKey) throw new Error('Groq API anahtarı yok');
    const items = tenders.map((t, i) => ({
      idx: i,
      title: t.name || '',
      authority: t.authority || '',
      city: t.province || '',
      type: t.type?.description || '',
    }));
    const body = {
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir analistsin. Açıklama yazma, code fence kullanma.' },
        { role: 'user', content: buildBatchPrompt({ businessContext, keywords, items }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 4096,
    };
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw tagError(new Error(`Groq ${res.status}: ${txt.slice(0, 240)}`), res.status);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.results)) {
      throw new Error('Groq batch yanıtı ayrıştırılamadı: ' + text.slice(0, 200));
    }
    return parsed.results;
  },
};

// ── OpenAI-compat generic adapter (Groq, DeepSeek, OpenRouter, Cerebras, SambaNova) ──
const https = require('https');

function oaiHttpsRequest(urlString, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        method,
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(JSON.parse(text)),
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(90_000, () => req.destroy(new Error('Timeout 90s')));
    if (body) req.write(body);
    req.end();
  });
}

function makeOpenAICompat({ baseUrl, defaultModel, extraHeaders = () => ({}) }) {
  return {
    async listModels({ apiKey }) {
      if (!apiKey) throw new Error('API anahtarı gerekli');
      const res = await oaiHttpsRequest(baseUrl + '/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders() },
      });
      if (!res.ok) {
        const t = await res.text();
        throw tagError(new Error(`Model listesi alınamadı (${res.status}): ${t.slice(0, 160)}`), res.status);
      }
      const data = await res.json();
      const models = Array.isArray(data.data) ? data.data : (data.models || []);
      return models
        .filter((m) => m.active !== false)
        .filter((m) => !/whisper|tts|embedding|guard|vision|prompt-guard|audio|image|dall/i.test(m.id || m.name || ''))
        .map((m) => ({
          name: m.id || m.name,
          displayName: m.name || m.id,
          inputTokenLimit: m.context_length || m.context_window || null,
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },

    async classify({ tender, businessContext, keywords, apiKey, model }) {
      if (!apiKey) throw new Error('API anahtarı yok');
      const body = {
        model: model || defaultModel,
        messages: [
          { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir analistsin. Açıklama yazma, code fence kullanma.' },
          { role: 'user', content: buildPrompt({ tender, businessContext, keywords }) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 256,
      };
      const res = await oaiHttpsRequest(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...extraHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw tagError(new Error(`${baseUrl} ${res.status}: ${t.slice(0, 240)}`), res.status);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const parsed = extractJson(text);
      if (!parsed) throw new Error('Yanıt JSON olarak ayrıştırılamadı: ' + text.slice(0, 200));
      return {
        relevant: !!parsed.relevant,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        reason: String(parsed.reason || '').slice(0, 240),
      };
    },

    async test({ apiKey, model }) {
      return this.classify({ ...SAMPLE, apiKey, model });
    },

    async classifyBatch({ tenders, businessContext, keywords, apiKey, model }) {
      if (!apiKey) throw new Error('API anahtarı yok');
      const items = tenders.map((t, i) => ({
        idx: i,
        title: t.name || '',
        authority: t.authority || '',
        city: t.province || '',
        type: t.type?.description || '',
      }));
      const body = {
        model: model || defaultModel,
        messages: [
          { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir analistsin. Açıklama yazma, code fence kullanma.' },
          { role: 'user', content: buildBatchPrompt({ businessContext, keywords, items }) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 4096,
      };
      const res = await oaiHttpsRequest(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...extraHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw tagError(new Error(`${baseUrl} ${res.status}: ${t.slice(0, 240)}`), res.status);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const parsed = extractJson(text);
      if (!parsed || !Array.isArray(parsed.results)) {
        throw new Error('Batch yanıtı ayrıştırılamadı: ' + text.slice(0, 200));
      }
      return parsed.results;
    },
  };
}

const openai = makeOpenAICompat({
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
});

const deepseek = makeOpenAICompat({
  baseUrl: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-chat',
});

const openrouter = makeOpenAICompat({
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'deepseek/deepseek-chat:free',
  extraHeaders: () => ({
    'HTTP-Referer': 'https://github.com/hamzaalmali/ihale-bot',
    'X-Title': 'Baratoprak Ihale Bot',
  }),
});

const cerebras = makeOpenAICompat({
  baseUrl: 'https://api.cerebras.ai/v1',
  defaultModel: 'llama-3.3-70b',
});

const sambanova = makeOpenAICompat({
  baseUrl: 'https://api.sambanova.ai/v1',
  defaultModel: 'Meta-Llama-3.3-70B-Instruct',
});

const PROVIDERS = { gemini, groq, openai, deepseek, openrouter, cerebras, sambanova };
function pick(p) {
  const sel = PROVIDERS[p] || PROVIDERS.gemini;
  return sel;
}

module.exports = {
  classifyTender: ({ provider = 'gemini', ...rest }) => pick(provider).classify(rest),
  classifyBatch: ({ provider = 'gemini', ...rest }) => pick(provider).classifyBatch(rest),
  listModels: ({ provider = 'gemini', apiKey }) => pick(provider).listModels({ apiKey }),
  testConnection: ({ provider = 'gemini', apiKey, model }) => pick(provider).test({ apiKey, model }),
  DEFAULT_MODEL: 'gemini-2.0-flash-lite',
};
