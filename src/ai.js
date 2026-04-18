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
    'Sen, bir Türk firmasının kamu ihalelerini filtreleyen yardımcısın.',
    '',
    'FİRMA İŞ ALANI:',
    ctx,
    '',
    `İLGİLİ ANAHTAR KELİMELER: ${kw || '(verilmedi)'}`,
    '',
    'İHALE BİLGİSİ:',
    `- Başlık: ${t.name || '(yok)'}`,
    `- İdare: ${t.authority || '(yok)'}`,
    `- Tür: ${t.type?.description || '(yok)'}`,
    `- Şehir: ${t.province || '(yok)'}`,
    '',
    'GÖREV:',
    'Bu ihale, firmanın iş alanına gerçekten uygun mu? Sadece başlığa bak, anahtar kelimelerin tesadüfen geçmesi yetmez.',
    'Örnekler:',
    '- "Belediye giyim alımı" → SCADA/elektrik dağıtım firmasıyla alakasız → false',
    '- "OG pano alımı" → elektrik dağıtım firmasıyla alakalı → true',
    '- "Güneş enerjisi santrali tedariki" → elektrik şirketleri ilgili olabilir, kullanıcının iş tanımı kapsamındaysa true',
    '',
    'JSON formatında cevap ver: { "relevant": true/false, "confidence": 0..1, "reason": "kısa Türkçe açıklama" }',
  ].join('\n');
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
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    '';
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    throw new Error('Gemini yanıtı JSON olarak ayrıştırılamadı: ' + text.slice(0, 160));
  }
  return {
    relevant: !!parsed.relevant,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    reason: String(parsed.reason || '').slice(0, 240),
  };
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

module.exports = { classifyTender, testConnection, DEFAULT_MODEL };
