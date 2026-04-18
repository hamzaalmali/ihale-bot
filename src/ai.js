// İki sağlayıcı: Google Gemini ve Groq (OpenAI uyumlu).
// Her ikisi de ücretsiz tier sunar:
//   - Gemini : aistudio.google.com/app/apikey  (1500 RPD, bazı bölgelerde dar)
//   - Groq   : console.groq.com/keys           (14400 RPD, Llama 3.3 70B, çok hızlı)

// ── Ortak yardımcılar ──────────────────────────────────────────────────────
function buildBatchPrompt({ businessContext, keywords, items }) {
  const ctx = String(businessContext || '').trim() || 'Genel ihale takibi';
  const kw = (keywords || []).slice(0, 30).join(', ');
  return [
    'Sen bir Türk firmasının kamu ihale filtre uzmanısın. Tutarlı ve titiz ol.',
    '',
    '═══ FİRMA PROFİLİ ═══',
    ctx,
    '',
    'İLGİLİ ANAHTAR KELİMELER (yön gösterir, tek başına yeterli değil):',
    kw,
    '',
    '═══ KARAR KURALLARI ═══',
    '1. Bir başlıkta anahtar kelime geçiyor diye otomatik "alakalı" deme; ihale konusunun firmanın gerçekten yaptığı işle örtüşmesi şart.',
    '2. Şüpheliyse FALSE tarafına eğil — false negative > false positive.',
    '3. Aynı tür ihaleyi her seferinde aynı kararla değerlendir.',
    '',
    '═══ ÖRNEKLER ═══',
    '"OG Pano Alımı" → relevant=true (doğrudan iş alanı)',
    '"SCADA Otomasyon Sistemi" → relevant=true',
    '"Trafo Bakımı" → relevant=true',
    '"Belediye Hizmet Binası Yapım İşi" → relevant=false (inşaat)',
    '"Koruyucu Giyim Donanım Malzemesi" → relevant=false (giyim)',
    '"Yemek Hizmeti" → relevant=false (catering)',
    '"Bilgisayar/Yazılım Alımı" → relevant=false (IT)',
    '"Tavuk/Süt Ürünleri" → relevant=false (gıda)',
    '"Zemin Kaplama" → relevant=false (yapı)',
    '',
    '═══ DEĞERLENDİRİLECEK İHALE LİSTESİ ═══',
    ...items.map((it) => `[${it.idx}] ${it.title || '(yok)'}  |  İdare: ${it.authority || '-'}  |  Tür: ${it.type || '-'}  |  Şehir: ${it.city || '-'}`),
    '',
    '═══ ÇIKTI ═══',
    'YALNIZCA aşağıdaki ham JSON nesnesini döndür. Açıklama metni veya markdown YOK.',
    '{ "results": [ { "idx": 0, "relevant": true, "confidence": 0.0..1.0, "reason": "kısa Türkçe gerekçe" }, ... ] }',
    'Listedeki her ihale için bir sonuç döndürmen şart.',
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

const PROVIDERS = { gemini, groq };
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
