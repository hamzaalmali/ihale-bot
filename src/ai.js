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
    '1. FİRMA PROFİLİ\'nde adı geçen ürün/hizmet ya da onunla DOĞRUDAN ilgili mal/hizmet → relevant=TRUE',
    '2. FİRMA PROFİLİ\'nde "alakasız" listesi veya çeşitli sektörlerin yan ürünleri → relevant=FALSE',
    '3. Başlık spesifik değilse (ör. "Elektrik Malzemesi", "Muhtelif Malzeme", "Genel Malzeme") → confidence 0.4-0.6 düşük tut (kullanıcı eşikle eler)',
    '4. Yüksek confidence (≥0.8) SADECE başlıkta SCADA, RTU, röle, koruma rölesi, OG/AG pano, modüler hücre, RMU, kesici, ölçü transformatörü, trafo merkezi gibi SEKTÖR-SPESİFİK terim varsa',
    '5. Yan ürün/aksesuar/yedek parça ihaleleri (elektrik/elektronik kapsamında olsalar bile) → FALSE (drenaj pompası, şarj istasyonu, UPS, yazılım, hırdavat)',
    '6. Başlığın BASKIN konusuna bak — içinde "elektrik" geçmesi yeterli DEĞİL.',
    '',
    '═══ POZİTİF ÖRNEKLER (confidence ≥ 0.8) ═══',
    '"SCADA Yazılım Güncelleme" → TRUE (1.0)',
    '"Koruma Rölesi Alımı" → TRUE (1.0)',
    '"Uzak Terminal Birimi (RTU) Alım İşi" → TRUE (1.0)',
    '"OG/AG Modüler Hücre Tedariki" → TRUE (1.0)',
    '"36 kV Kesici / Ayıran Alımı" → TRUE (0.9)',
    '"Kontrol Panosu İmalat ve Montajı" → TRUE (1.0)',
    '"Trafo Merkezi SCADA Entegrasyonu" → TRUE (1.0)',
    '"RMU (Ring Main Unit) Alımı" → TRUE (1.0)',
    '"Scada ve Otomasyon Revize İşi" → TRUE (0.95)',
    '"Primer / Sekonder Koruma Sistemi" → TRUE (0.9)',
    '"Uzaktan İzleme / DMS / EMS Sistemi" → TRUE (0.9)',
    '',
    '═══ DÜŞÜK GÜVENLİ POZİTİF (0.4-0.6) — başlık çok genel ═══',
    '"Muhtelif Elektrik Malzemesi" → TRUE (0.5) — içerik belirsiz',
    '"Elektrik Malzemesi Alımı" → TRUE (0.5) — belediye/genel elektrik hırdavat olabilir',
    '',
    '═══ NEGATİF ÖRNEKLER (FALSE) ═══',
    '"Koruyucu Giyim Donanım Malzemesi" → FALSE — giyim',
    '"Yemek / Kahvaltılık / Süt / Gıda Alımı" → FALSE — gıda',
    '"İlaç Alımı" → FALSE — eczane',
    '"Belediye Hizmet Binası / Okul / Halı Saha Yapım" → FALSE — inşaat',
    '"Zemin Kaplama / Asfalt / Yol Yapım" → FALSE — yapı',
    '"Yakıt / Motorin / Kalorifer" → FALSE — akaryakıt',
    '"Araç Kiralama / Yolcu Taşıma" → FALSE — taşıma/ulaşım',
    '"Network / Bilgisayar / Yedekleme / Dijital Tasarım Yazılımı" → FALSE — IT, SCADA değil',
    '"Sayaç Alımı" (su/elektrik tüketim sayacı) → FALSE',
    '"Drenaj Pompası / Sirkülasyon Pompası / Hidrofor / Yedek Parça" → FALSE — pompa ekipmanı',
    '"Elektrikli Araç Şarj İstasyonu" → FALSE — e-şarj altyapısı',
    '"UPS ve Data Altyapı Malzeme" → FALSE — IT altyapı',
    '"Kablo / Stanka Alımı" → FALSE — kablo hırdavatı (pano/SCADA üreticisi değilse)',
    '"Elektrik-Hırdavat / Aydınlatma / Genel Malzeme" → FALSE — genel tesisat',
    '"Termal Kamera (Tarım / Vektör)" → FALSE',
    '"Koruyucu Giyim" → FALSE (kesinlikle)',
    '"Personel Çalıştırma / Hizmet Alımı" → FALSE',
    '"Atölye Malzemesi / Muhtelif Atölye" → FALSE',
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

const openrouterBase = makeOpenAICompat({
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'deepseek/deepseek-chat:free',
  extraHeaders: () => ({
    'HTTP-Referer': 'https://github.com/hamzaalmali/ihale-bot',
    'X-Title': 'Baratoprak Ihale Bot',
  }),
});
const openrouter = {
  ...openrouterBase,
  async listModels(args) {
    const all = await openrouterBase.listModels(args);
    // :free modelleri üste koy, sonra ücretliler
    const free = all.filter((m) => /:free$/i.test(m.name));
    const paid = all.filter((m) => !/:free$/i.test(m.name));
    return [...free, ...paid];
  },
};

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
