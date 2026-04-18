// Google Gemini ile ihale alaka sınıflandırması.
// Free tier: aistudio.google.com/app/apikey

const DEFAULT_MODEL = 'gemini-2.0-flash';
const ENDPOINT = (model, apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['relevant', 'reason'],
};

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
    '3. Şüpheliyse "false" tarafına eğil (false negative > false positive). Kullanıcı bant genişliğini boşa harcamak istemez.',
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
    'YALNIZCA aşağıdaki şemada ham JSON döndür. Açıklama metni, "Here is...", markdown code fence (```), satır öncesi/sonrası boşluk YOK.',
    '{ "relevant": boolean, "confidence": 0..1, "reason": "kısa Türkçe gerekçe" }',
    'reason 1-2 cümle olsun, neden alakalı/alakasız olduğunu somut belirt.',
  ].join('\n');
}

// Markdown code fence, "Here is the JSON" gibi prefix/suffix'leri temizleyip
// metinden ilk JSON nesnesini çıkarır. Gemini 2.5 modelleri çoğu zaman
// responseMimeType=application/json'a rağmen ham JSON dönmez.
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  // ```json ... ``` veya ``` ... ``` bloklarını soy
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // İlk { ... son } arasını al
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (_) { return null; }
}

async function classifyTender({ tender, businessContext, keywords, apiKey, model }) {
  if (!apiKey) throw new Error('Gemini API anahtarı yok');
  const url = ENDPOINT(model || DEFAULT_MODEL, apiKey);
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
    const err = new Error(`Gemini ${res.status}: ${txt.slice(0, 240)}`);
    err.status = res.status;
    if (res.status === 429) err.code = 'RATE_LIMIT';
    if (res.status === 403) err.code = 'AUTH';
    if (res.status === 404) err.code = 'MODEL_NOT_FOUND';
    throw err;
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    '';
  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error('Gemini yanıtı JSON olarak ayrıştırılamadı: ' + text.slice(0, 200));
  }
  return {
    relevant: !!parsed.relevant,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    reason: String(parsed.reason || '').slice(0, 240),
  };
}

async function listModels({ apiKey }) {
  if (!apiKey) throw new Error('API anahtarı gerekli');
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`Model listesi alınamadı (${res.status}): ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const all = Array.isArray(data.models) ? data.models : [];
  return all
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({
      name: String(m.name || '').replace(/^models\//, ''),
      displayName: m.displayName || m.name,
      description: m.description || '',
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
    }))
    .filter((m) => /^gemini-/i.test(m.name) && !/embedding|aqa|imagen|veo/i.test(m.name))
    .sort((a, b) => {
      // Önce flash-lite/flash, sonra pro; içinde versiyon büyükten küçüğe
      const score = (n) =>
        (/flash-lite/i.test(n) ? 1 : /flash/i.test(n) ? 2 : 3) * 100 -
        parseFloat((n.match(/(\d+\.\d+)/) || [0, 0])[1] || 0);
      return score(a.name) - score(b.name);
    });
}

async function testConnection({ apiKey, model }) {
  return classifyTender({
    tender: { name: 'OG Pano Alımı', authority: 'Test Belediyesi', province: 'ANKARA', type: { description: 'Mal' } },
    businessContext: 'Elektrik dağıtım için OG/AG pano üreticisi',
    keywords: ['og pano', 'scada', 'trafo'],
    apiKey,
    model,
  });
}

module.exports = { classifyTender, testConnection, listModels, DEFAULT_MODEL };
