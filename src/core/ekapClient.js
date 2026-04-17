// Port of ihale_client.py — EKAP v2 API client
const crypto = require('crypto');
const https = require('https');
const { htmlToMarkdown, textPreview } = require('./html2md');
const {
  DIRECT_PROCUREMENT_TYPES,
  DIRECT_PROCUREMENT_STATUSES,
  DIRECT_PROCUREMENT_SCOPES,
  DIRECT_PROCUREMENT_STATUS_ALIASES,
  DIRECT_PROCUREMENT_SCOPE_ALIASES,
  NAME_TO_PLATE,
  ANNOUNCEMENT_TYPE_CODE_MAP,
} = require('./models');

const BASE_URL = 'https://ekapv2.kik.gov.tr';
const TENDER_ENDPOINT = '/b_ihalearama/api/Ihale/GetListByParameters';
const OKAS_ENDPOINT = '/b_ihalearama/api/IhtiyacKalemleri/GetAll';
const AUTHORITY_ENDPOINT = '/b_idare/api/DetsisKurumBirim/DetsisAgaci';
const ANNOUNCEMENTS_ENDPOINT = '/b_ihalearama/api/Ilan/GetList';
const TENDER_DETAILS_ENDPOINT = '/b_ihalearama/api/IhaleDetay/GetByIhaleIdIhaleDetay';
const DOCUMENT_URL_ENDPOINT = '/b_ihalearama/api/EkapDokumanYonlendirme/GetDokumanUrl';
const DIRECT_PROCUREMENT_URL = 'https://ekap.kik.gov.tr/EKAP/Ortak/YeniIhaleAramaData.ashx';
const LEGACY_WARMUP_URL = 'https://ekap.kik.gov.tr/EKAP/YeniIhaleArama.aspx';

// AES-192 key taken from EKAP frontend env (same as Python client).
const R8_KEY = Buffer.from('Qm2LtXR0aByP69vZNKef4wMJ', 'utf8');

const COMMON_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'tr',
  Connection: 'keep-alive',
  'Content-Type': 'application/json',
  Origin: 'https://ekapv2.kik.gov.tr',
  Referer: 'https://ekapv2.kik.gov.tr/ekap/search',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'api-version': 'v1',
  'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

const LEGACY_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'identity',
  Connection: 'keep-alive',
  Referer: 'https://ekap.kik.gov.tr/EKAP/YeniIhaleArama.aspx',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

// Match Python client's `verify=False` + relaxed SSL (EKAP uses old cipher policy).
const insecureAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

function aesCbcEncryptB64(plaintext, key, iv) {
  // AES-192-CBC (24-byte key) with PKCS7 padding (default).
  const cipher = crypto.createCipheriv('aes-192-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

function generateSecurityHeaders() {
  const guid = crypto.randomUUID();
  const iv = crypto.randomBytes(16);
  const tsMs = String(Date.now());
  return {
    'X-Custom-Request-Guid': guid,
    'X-Custom-Request-Siv': iv.toString('base64'),
    'X-Custom-Request-Ts': aesCbcEncryptB64(tsMs, R8_KEY, iv),
    'X-Custom-Request-R8id': aesCbcEncryptB64(guid, R8_KEY, iv),
  };
}

function buildQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.join('&');
}

// ── Session (cookie jar) state for legacy endpoint ──────────────────────────
let legacyCookieJar = {}; // name → value
function mergeSetCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const raw of arr) {
    const pair = String(raw).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) legacyCookieJar[name] = value;
  }
}
function jarAsHeader() {
  return Object.entries(legacyCookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function getSetCookieArray(res) {
  // Node fetch exposes combined headers via res.headers.getSetCookie() (undici).
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const h = res.headers.get('set-cookie');
  return h ? [h] : [];
}

async function postJson(endpoint, payload) {
  const url = endpoint.startsWith('http') ? endpoint : BASE_URL + endpoint;
  const headers = { ...COMMON_HEADERS, ...generateSecurityHeaders() };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    // @ts-ignore: Electron/undici accepts a Node https.Agent for TLS relaxation
    agent: insecureAgent,
    dispatcher: undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`EKAP ${endpoint} HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

async function getLegacy(url, params, extraCookies = null) {
  const qs = buildQuery(params);
  const full = qs ? `${url}?${qs}` : url;
  const cookieHeader =
    (typeof extraCookies === 'string' && extraCookies.trim()) ? extraCookies : jarAsHeader();
  const headers = { ...LEGACY_HEADERS };
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetch(full, {
    method: 'GET',
    headers,
    redirect: 'manual',
    agent: insecureAgent,
  });
  mergeSetCookies(getSetCookieArray(res));

  // Python logic: if 302 → /EKAP/error_page.html and no cookies provided, warm up and retry once.
  const location = res.headers.get('location') || '';
  if (res.status === 302 && location.includes('/EKAP/error_page.html') && !extraCookies) {
    await warmupLegacy();
    const res2 = await fetch(full, {
      method: 'GET',
      headers: { ...LEGACY_HEADERS, Cookie: jarAsHeader() },
      redirect: 'manual',
      agent: insecureAgent,
    });
    mergeSetCookies(getSetCookieArray(res2));
    if (!res2.ok) {
      throw new Error(`EKAP legacy HTTP ${res2.status}`);
    }
    return res2.json();
  }
  if (!res.ok) throw new Error(`EKAP legacy HTTP ${res.status}`);
  return res.json();
}

async function warmupLegacy() {
  try {
    const r1 = await fetch(LEGACY_WARMUP_URL, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': LEGACY_HEADERS['User-Agent'],
        Connection: 'keep-alive',
      },
      redirect: 'follow',
      agent: insecureAgent,
    });
    mergeSetCookies(getSetCookieArray(r1));
  } catch (_) {}
  try {
    const r2 = await fetch(
      `${DIRECT_PROCUREMENT_URL}?metot=idareAra&aranan=a`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'tr-TR,tr;q=0.9',
          'User-Agent': LEGACY_HEADERS['User-Agent'],
          Connection: 'keep-alive',
        },
        redirect: 'follow',
        agent: insecureAgent,
      }
    );
    mergeSetCookies(getSetCookieArray(r2));
  } catch (_) {}
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
}

function safeInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── search_tenders ──────────────────────────────────────────────────────────
async function searchTenders(opts = {}) {
  const {
    searchText = '',
    iknYear = null,
    iknNumber = null,
    tenderTypes = null,
    tenderDateStart = null,
    tenderDateEnd = null,
    announcementDateStart = null,
    announcementDateEnd = null,
    searchType = 'GirdigimGibi',
    orderBy = 'ihaleTarihi',
    sortOrder = 'desc',
    // Boolean filters
    eIhale = null,
    eEksiltmeYapilacakMi = null,
    ortakAlimMi = null,
    kismiTeklifMi = null,
    fiyatDisiUnsurVarmi = null,
    ekonomikMaliYeterlilikBelgeleriIsteniyorMu = null,
    meslekiTeknikYeterlilikBelgeleriIsteniyorMu = null,
    isDeneyimiGosterenBelgelerIsteniyorMu = null,
    yerliIstekliyeFiyatAvantajiUygulaniyorMu = null,
    yabanciIsteklilereIzinVeriliyorMu = null,
    alternatifTeklifVerilebilirMi = null,
    konsorsiyumKatilabilirMi = null,
    altYukleniciCalistirilabilirMi = null,
    fiyatFarkiVerilecekMi = null,
    avansVerilecekMi = null,
    cerceveAnlasmasiMi = null,
    personelCalistirilmasinaDayaliMi = null,
    // List filters
    provinces = null, // already API IDs (245-325) — plate conversion handled upstream
    tenderStatuses = null,
    tenderMethods = null,
    tenderSubMethods = null,
    okasCodes = null,
    okasNames = null,
    authorityIds = null,
    proposalTypes = null,
    announcementTypes = null,
    // Search scope
    searchInIkn = true,
    searchInTitle = true,
    searchInAnnouncement = true,
    searchInTechSpec = true,
    searchInAdminSpec = true,
    searchInSimilarWork = true,
    searchInLocation = true,
    searchInNatureQuantity = true,
    searchInTenderInfo = true,
    searchInContractDraft = true,
    searchInBidForm = true,
    skip = 0,
    limit = 10,
  } = opts;

  const payload = {
    searchText: searchText,
    filterType: null,
    ikNdeAra: !!searchInIkn,
    ihaleAdindaAra: !!searchInTitle,
    ihaleIlanindaAra: !!searchInAnnouncement,
    teknikSartnamedeAra: !!searchInTechSpec,
    idariSartnamedeAra: !!searchInAdminSpec,
    benzerIsMaddesindeAra: !!searchInSimilarWork,
    isinYapilacagiYerMaddesindeAra: !!searchInLocation,
    nitelikTurMiktarMaddesindeAra: !!searchInNatureQuantity,
    ihaleBilgilerindeAra: !!searchInTenderInfo,
    sozlesmeTasarisindaAra: !!searchInContractDraft,
    teklifCetvelindeAra: !!searchInBidForm,
    searchType,
    iknYili: iknYear,
    iknSayi: iknNumber,
    ihaleTarihSaatBaslangic: formatDate(tenderDateStart),
    ihaleTarihSaatBitis: formatDate(tenderDateEnd),
    ilanTarihSaatBaslangic: formatDate(announcementDateStart),
    ilanTarihSaatBitis: formatDate(announcementDateEnd),
    yasaKapsami4734List: [],
    ihaleTuruIdList: tenderTypes || [],
    ihaleUsulIdList: tenderMethods || [],
    ihaleUsulAltIdList: tenderSubMethods || [],
    ihaleIlIdList: provinces || [],
    ihaleDurumIdList: tenderStatuses || [],
    idareIdList: authorityIds || [],
    ihaleIlanTuruIdList: announcementTypes || [],
    teklifTuruIdList: proposalTypes || [],
    asiriDusukTeklifIdList: [],
    istisnaMaddeIdList: [],
    okasBransKodList: okasCodes || [],
    okasBransAdiList: okasNames || [],
    titubbKodList: [],
    gmdnKodList: [],
    eIhale,
    eEksiltmeYapilacakMi,
    ortakAlimMi,
    kismiTeklifMi,
    fiyatDisiUnsurVarmi,
    ekonomikVeMaliYeterlilikBelgeleriIsteniyorMu: ekonomikMaliYeterlilikBelgeleriIsteniyorMu,
    meslekiTeknikYeterlilikBelgeleriIsteniyorMu,
    isDeneyimiGosterenBelgelerIsteniyorMu,
    yerliIstekliyeFiyatAvantajiUgulaniyorMu: yerliIstekliyeFiyatAvantajiUygulaniyorMu,
    yabanciIsteklilereIzinVeriliyorMu,
    alternatifTeklifVerilebilirMi,
    konsorsiyumKatilabilirMi,
    altYukleniciCalistirilabilirMi,
    fiyatFarkiVerilecekMi,
    avansVerilecekMi,
    cerceveAnlasmaMi: cerceveAnlasmasiMi,
    personelCalistirilmasinaDayaliMi,
    orderBy,
    siralamaTipi: sortOrder,
    paginationSkip: skip,
    paginationTake: limit,
  };

  try {
    const data = await postJson(TENDER_ENDPOINT, payload);
    const list = data.list || [];
    const totalCount = data.totalCount || 0;

    const formatted = [];
    for (const tender of list) {
      const tenderId = tender.id;
      let documentUrl = null;
      if (tenderId && (tender.dokumanSayisi || 0) > 0) {
        try {
          const docRes = await getTenderDocumentUrl(String(tenderId));
          if (docRes && docRes.success) documentUrl = docRes.document_url;
        } catch (_) {}
      }
      formatted.push({
        id: tenderId,
        name: tender.ihaleAdi,
        ikn: tender.ikn,
        type: { code: tender.ihaleTip, description: tender.ihaleTipAciklama },
        method: tender.ihaleUsulAciklama,
        status: { code: tender.ihaleDurum, description: tender.ihaleDurumAciklama },
        authority: tender.idareAdi,
        province: tender.ihaleIlAdi,
        tender_datetime: tender.ihaleTarihSaat,
        document_count: tender.dokumanSayisi || 0,
        has_announcement: !!tender.ilanVarMi,
        document_url: documentUrl,
      });
    }

    return {
      tenders: formatted,
      total_count: totalCount,
      returned_count: formatted.length,
    };
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

// ── search_okas_codes ───────────────────────────────────────────────────────
async function searchOkasCodes({ searchTerm = '', kalemTuru = null, limit = 50 } = {}) {
  let take = limit;
  if (take > 500) take = 500;
  if (take < 1) take = 1;

  const filter = [];
  if (searchTerm) {
    filter.push(['kalemAdi', 'contains', searchTerm], 'or', ['kalemAdiEng', 'contains', searchTerm]);
  }

  const payload = {
    loadOptions: {
      filter: {
        sort: [], group: [], filter: filter.length ? filter : [],
        totalSummary: [], groupSummary: [], select: [], preSelect: [], primaryKey: [],
      },
      take,
    },
  };

  try {
    const data = await postJson(OKAS_ENDPOINT, payload);
    const items = (data.loadResult && data.loadResult.data) || [];
    const descMap = { 1: 'Mal (Goods)', 2: 'Hizmet (Service)', 3: 'Yapım (Construction)' };

    const results = [];
    for (const it of items) {
      if (kalemTuru !== null && it.kalemTuru !== kalemTuru) continue;
      results.push({
        id: it.id,
        code: it.kod,
        description_tr: it.kalemAdi,
        description_en: it.kalemAdiEng,
        item_type: { code: it.kalemTuru, description: descMap[it.kalemTuru] || 'Unknown' },
        code_level: it.kodLevel,
        parent_id: it.parentId,
        has_items: !!it.hasItem,
        child_count: it.childCount || 0,
      });
    }
    const trimmed = results.slice(0, take);
    return {
      okas_codes: trimmed,
      total_found: trimmed.length,
      search_params: { search_term: searchTerm, kalem_turu: kalemTuru, limit: take },
      item_type_legend: { 1: 'Mal (Goods)', 2: 'Hizmet (Service)', 3: 'Yapım (Construction)' },
    };
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

async function resolveOkasNames(okasCodes) {
  if (!okasCodes || !okasCodes.length) return [];
  const filter = [];
  okasCodes.forEach((code, i) => {
    if (i > 0) filter.push('or');
    filter.push(['kod', '=', code]);
  });
  const payload = {
    loadOptions: {
      filter: {
        sort: [], group: [], filter, totalSummary: [], groupSummary: [],
        select: [], preSelect: [], primaryKey: [],
      },
      take: okasCodes.length,
    },
  };
  try {
    const data = await postJson(OKAS_ENDPOINT, payload);
    const items = (data.loadResult && data.loadResult.data) || [];
    const map = {};
    for (const it of items) if (it.kod) map[it.kod] = it.kalemAdi || '';
    return okasCodes.map((c) => map[c] || '');
  } catch (_) {
    return okasCodes.map(() => '');
  }
}

// ── search_authorities ──────────────────────────────────────────────────────
async function searchAuthorities({ searchTerm = '', limit = 50 } = {}) {
  let take = limit;
  if (take > 500) take = 500;
  if (take < 1) take = 1;

  const filter = [];
  if (searchTerm) filter.push(['ad', 'contains', searchTerm]);

  const payload = {
    loadOptions: {
      filter: {
        sort: [], group: [], filter: filter.length ? filter : [],
        totalSummary: [], groupSummary: [], select: [], preSelect: [], primaryKey: [],
      },
      take,
    },
  };

  try {
    const data = await postJson(AUTHORITY_ENDPOINT, payload);
    const items = (data.loadResult && data.loadResult.data) || [];
    const results = items.map((it) => ({
      id: it.id,
      name: it.ad,
      parent_id: it.parentIdareKimlikKodu,
      level: it.seviye,
      has_children: !!it.hasItems,
      child_count: 0,
      detsis_no: it.detsisNo,
      idare_id: it.idareId,
    }));
    return {
      authorities: results,
      total_found: results.length,
      search_params: { search_term: searchTerm, limit: take },
    };
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

// ── get_tender_announcements ────────────────────────────────────────────────
async function getTenderAnnouncements(tenderId) {
  const payload = { ihaleId: tenderId };
  try {
    const data = await postJson(ANNOUNCEMENTS_ENDPOINT, payload);
    const list = data.list || [];
    const results = list.map((ann) => {
      const code = ann.ilanTip || '';
      const html = ann.veriHtml || '';
      return {
        id: ann.id,
        type: { code, description: ANNOUNCEMENT_TYPE_CODE_MAP[code] || `Type ${code}` },
        title: ann.baslik,
        date: ann.ilanTarihi,
        status: ann.status,
        tender_id: ann.ihaleId,
        contract_id: ann.sozlesmeId,
        bidder_name: ann.istekliAdi,
        markdown_content: htmlToMarkdown(html),
        content_preview: textPreview(html),
      };
    });
    return { announcements: results, total_count: results.length, tender_id: tenderId };
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

// ── get_tender_details ──────────────────────────────────────────────────────
async function getTenderDetails(tenderId) {
  const payload = { ihaleId: tenderId };
  try {
    const data = await postJson(TENDER_DETAILS_ENDPOINT, payload);
    const item = data.item || {};
    if (!item || !Object.keys(item).length) {
      return { error: 'Tender details not found', tender_id: tenderId };
    }

    const characteristics = (item.ihaleOzellikList || []).map((c) => {
      let t = c.ihaleOzellik || '';
      if (t.includes('TENDER_DETAIL.')) {
        t = t.replace('TENDER_DETAIL.', '').replace(/_/g, ' ');
        t = t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      }
      return t;
    });

    const basicInfo = item.ihaleBilgi || {};

    const okasCodes = (item.ihtiyacKalemiOkasList || []).map((o) => ({
      code: o.kodu,
      name: o.adi,
      full_description: o.koduAdi,
    }));

    const authority = item.idare || {};
    const authorityInfo = {
      id: authority.id,
      name: authority.adi,
      code1: authority.kod1,
      code2: authority.kod2,
      phone: authority.telefon,
      fax: authority.fax,
      parent_authority: authority.ustIdare,
      top_authority_code: authority.enUstIdareKod,
      top_authority_name: authority.enUstIdareAdi,
      province: authority.il ? authority.il.adi : undefined,
      district: authority.ilce ? authority.ilce.ilceAdi : undefined,
    };

    const rules = item.islemlerKuralSeti || {};
    const processRules = {
      can_download_documents: !!rules.dokumanIndirmisMi,
      has_submitted_bid: !!rules.teklifteBulunmusMu,
      can_submit_bid: !!rules.teklifVerilebilirMi,
      has_non_price_factors: !!rules.fiyatDisiUnsurVarMi,
      contract_signed: !!rules.sozlesmeImzaliMi,
      is_electronic: !!rules.eIhaleMi,
      is_own_tender: !!rules.idareKendiIhaleMi,
      electronic_auction: !!rules.eEksiltmeYapilacakMi,
    };

    const announcements = (item.ilanList || []).map((ann) => {
      const code = ann.ilanTip || '';
      const html = ann.veriHtml || '';
      return {
        id: ann.id,
        type: { code, description: ANNOUNCEMENT_TYPE_CODE_MAP[code] || `Type ${code}` },
        title: ann.baslik,
        date: ann.ilanTarihi,
        status: ann.status,
        markdown_content: htmlToMarkdown(html),
        content_preview: textPreview(html),
      };
    });

    const result = {
      tender_id: item.id,
      ikn: item.ikn,
      name: item.ihaleAdi,
      status: { code: item.ihaleDurum, description: basicInfo.ihaleDurumAciklama },
      basic_info: {
        is_electronic: !!item.eIhale,
        method_code: item.ihaleUsul,
        method_description: basicInfo.ihaleUsulAciklama,
        type_description: basicInfo.ihaleTipiAciklama,
        scope_description: item.ihaleKapsamAciklama,
        tender_datetime: basicInfo.ihaleTarihSaat,
        location: basicInfo.isinYapilacagiYer,
        venue: basicInfo.ihaleYeri,
        complaint_fee: basicInfo.itirazenSikayetBasvuruBedeli,
        is_partial: !!item.kismiIhale,
      },
      characteristics,
      okas_codes: okasCodes,
      authority: authorityInfo,
      process_rules: processRules,
      announcements_summary: {
        total_count: announcements.length,
        announcements,
        types_available: Array.from(new Set(announcements.map((a) => a.type.description))),
      },
      flags: {
        is_authority_tender: !!item.ihaleniIdaresiMi,
        is_without_announcement: !!item.ihaleIlansizMi,
        is_invitation_only: !!item.ihaleyeDavetEdilenMi,
        show_detail_documents: !!item.ihaleDetayDokumaniGorsunMu,
        show_document_downloaders: !!item.dokumanIndirenlerGosterilsinMi,
      },
      document_count: item.dokumanSayisi || 0,
    };

    if (basicInfo.iptalTarihi) {
      result.cancellation_info = {
        cancelled_date: basicInfo.iptalTarihi,
        cancellation_reason: basicInfo.iptalNedeni,
        cancellation_article: basicInfo.iptalMadde,
      };
    }

    return result;
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

// ── get_tender_document_url ─────────────────────────────────────────────────
async function getTenderDocumentUrl(tenderId, islemId = '1') {
  const payload = { islemId, ihaleId: tenderId };
  try {
    const data = await postJson(DOCUMENT_URL_ENDPOINT, payload);
    const url = data.url || null;
    if (url) return { document_url: url, tender_id: tenderId, islem_id: islemId, success: true };
    return { error: 'No document URL found', tender_id: tenderId, success: false };
  } catch (err) {
    return {
      error: `API request failed${err.status ? ' with status ' + err.status : ''}`,
      message: err.message,
      success: false,
    };
  }
}

// ── search_direct_procurement_authorities ───────────────────────────────────
async function searchDirectProcurementAuthorities({ searchTerm = '', cookies = null } = {}) {
  const params = { metot: 'idareAra', aranan: searchTerm || '', ES: '', ihaleidListesi: '' };
  try {
    const data = await getLegacy(DIRECT_PROCUREMENT_URL, params, cookies);
    const items = data.idareAramaResultList || [];
    const results = items.map((it) => ({ token: it.A, name: it.D }));
    return { authorities: results, returned_count: results.length, search_term: searchTerm };
  } catch (err) {
    return { error: 'Authority search failed', message: err.message };
  }
}

async function searchDirectProcurementParentAuthorities({ searchTerm = '', cookies = null } = {}) {
  const params = { metot: 'ustIdareAra', aranan: searchTerm || '', ES: '', ihaleidListesi: '' };
  try {
    const data = await getLegacy(DIRECT_PROCUREMENT_URL, params, cookies);
    const items = data.ustIdareAramaResultList || [];
    const results = items.map((it) => ({ token: it.A, name: it.D }));
    return { parent_authorities: results, returned_count: results.length, search_term: searchTerm };
  } catch (err) {
    return { error: 'Parent authority search failed', message: err.message };
  }
}

// ── search_direct_procurements ──────────────────────────────────────────────
async function searchDirectProcurements(opts = {}) {
  let {
    searchText = '',
    searchInDescription = true,
    searchInName = true,
    searchInInfo = true,
    pageIndex = 1,
    orderBy = 10,
    year = null,
    dtNo = null,
    dtNumber = null,
    dtType = null,
    ePriceOffer = null,
    statusId = null,
    statusText = null,
    dateStart = null,
    dateEnd = null,
    provincePlate = null,
    provinceName = null,
    scopeId = null,
    scopeText = null,
    authorityId = null,
    parentAuthorityCode = null,
    topAuthorityCode = null,
    cookies = null,
  } = opts;

  if (pageIndex < 1) pageIndex = 1;
  const params = {
    metot: 'dtAra',
    arananIfade: searchText || '',
    dtAciklama: searchInDescription ? 1 : 0,
    dtAdi: searchInName ? 1 : 0,
    dtBilgiSecim: searchInInfo ? 1 : 0,
    orderBy,
    pageIndex,
  };

  if (year !== null && year !== undefined) {
    params.dtnYil = year > 99 ? year % 100 : year;
  }
  if (dtNumber !== null && dtNumber !== undefined) {
    params.dtnSayi = dtNumber;
  } else if (dtNo) {
    const m = String(dtNo).trim().match(/^(\d{2})DT(\d+)$/i);
    if (m) {
      if (params.dtnYil === undefined) params.dtnYil = Number(m[1]);
      params.dtnSayi = Number(m[2]);
    } else {
      const digits = String(dtNo).replace(/\D/g, '');
      if (digits) params.dtnSayi = Number(digits);
    }
  }
  if (dtType !== null && dtType !== undefined) params.dtTuru = dtType;
  if (ePriceOffer !== null && ePriceOffer !== undefined) params.eihale = ePriceOffer ? 'true' : 'false';

  if (statusId === null && statusText) {
    const s = String(statusText).trim().toLowerCase();
    if (/^\d+$/.test(s)) statusId = Number(s);
    if (statusId === null) {
      const byText = {};
      for (const [k, v] of Object.entries(DIRECT_PROCUREMENT_STATUSES)) byText[v.toLowerCase()] = Number(k);
      statusId = byText[s] ?? DIRECT_PROCUREMENT_STATUS_ALIASES[s] ?? null;
    }
  }
  if (statusId !== null && statusId !== undefined) params.dtDurum = statusId;

  if (dateStart) params.dtTarihiBaslangic = formatDate(dateStart);
  if (dateEnd) params.dtTarihiBitis = formatDate(dateEnd);

  if (provincePlate === null && provinceName) {
    const plate = NAME_TO_PLATE[String(provinceName).trim().toUpperCase()];
    if (plate !== undefined) provincePlate = plate;
  }
  if (provincePlate !== null && provincePlate !== undefined) params.ilID = provincePlate;

  if (scopeId === null && scopeText) {
    const s = String(scopeText).trim().toLowerCase();
    if (/^\d+$/.test(s)) scopeId = Number(s);
    if (scopeId === null) {
      const byText = {};
      for (const [k, v] of Object.entries(DIRECT_PROCUREMENT_SCOPES)) byText[v.toLowerCase()] = Number(k);
      scopeId = byText[s] ?? DIRECT_PROCUREMENT_SCOPE_ALIASES[s] ?? null;
    }
  }
  if (scopeId !== null && scopeId !== undefined) params.dtKapsami = scopeId;

  if (authorityId !== null && authorityId !== undefined) params.idareId = authorityId;
  if (parentAuthorityCode) params.ustIdareKod = parentAuthorityCode;
  if (topAuthorityCode) params.enUstIdareKod = topAuthorityCode;

  try {
    const data = await getLegacy(DIRECT_PROCUREMENT_URL, params, cookies);
    const items = data.yeniDogrudanTeminAramaResultList || [];
    const results = items.map((it) => {
      const tcode = safeInt(it.E4);
      return {
        dt_no: it.E1,
        title: it.E2,
        authority: it.E3,
        type: { code: tcode, description: DIRECT_PROCUREMENT_TYPES[tcode] || 'Bilinmiyor' },
        due_datetime: it.E7,
        announcement_date: it.E8,
        detail_token: it.E10,
        announcement_token: it.E11,
        province_plate: safeInt(it.E12),
        has_announcement: !!it.E13,
        has_document: !!it.E14,
      };
    });
    return {
      direct_procurements: results,
      returned_count: results.length,
      page_index: pageIndex,
      search_params: { search_text: searchText, year, dt_no: dtNo, dt_type: dtType, province_plate: provincePlate },
    };
  } catch (err) {
    return { error: 'Direct procurement request failed', message: err.message };
  }
}

// ── get_direct_procurement_details ──────────────────────────────────────────
async function getDirectProcurementDetails({ dogrudanTeminId, idareId, cookies = null }) {
  const params = { metot: 'dtDetayGetir', dogrudanTeminId, idareId };
  try {
    const data = await getLegacy(DIRECT_PROCUREMENT_URL, params, cookies);
    const detail = data.dogrudanTeminDetayResult || {};
    if (!detail || !Object.keys(detail).length) {
      return { error: 'No details found', success: false };
    }
    const dt = detail.DogrudanTeminBilgileri || {};
    const idare = detail.IdareBilgileri || {};
    const ilan = detail.IlanBilgileri || {};
    const sozlesme = detail.SozlesmeBilgileri || {};

    const announcements = [];
    const appendAnns = (arr, category) => {
      if (!arr) return;
      for (const it of arr) {
        announcements.push({
          category,
          date: it.IlanTarihi,
          type_code: it.IlanTipi,
          enc_id: it.EncIlanId,
        });
      }
    };
    appendAnns(ilan.DogrudanTeminIlanBilgisiList, 'ilan');
    appendAnns(ilan.DuzeltmeIlanBilgisiList, 'duzeltme');
    appendAnns(ilan.IptalIlanBilgisiList, 'iptal');
    appendAnns(ilan.SonucIlanBilgisiList, 'sonuc');

    return {
      basic: {
        dt_no: dt.Dtn,
        name: dt.IsinAdi,
        type: dt.Turu,
        scope_article: dt.YasaKapsamiTeminMaddesi,
        kismi_teklif: dt.KismiTeklif,
        parts_count: dt.KisimSayisi,
        okas_codes: dt.BransKodList || [],
        announcement_form: dt.IlaninSekli,
        dt_datetime: dt.DtTarihSaati,
        status: dt.DtDurumu,
        cancel_reason: dt.IptalNedeni,
        cancel_date: dt.IptalTarihi,
        will_announce: dt.DogrudanTeminDuyurusuYapilacakMi,
        is_electronic: dt.EIhale,
        has_contract_draft: dt.DogrudanTeminSozlesmeTasarisiVarMi,
        exception_basis: dt.IstisnaAliminDayanagi,
        regulation_basis: dt.MevzuatDayanagi,
      },
      authority: {
        top_authority: idare.EnUstIdare,
        parent_authority: idare.UstIdare,
        name: idare.Idare,
        province: idare.Ili,
      },
      announcements,
      contracts: sozlesme.SozlesmeBilgisiList || [],
      tokens: { dogrudanTeminId, idareId },
      success: true,
    };
  } catch (err) {
    return { error: 'Direct procurement detail request failed', message: err.message, success: false };
  }
}

module.exports = {
  searchTenders,
  searchOkasCodes,
  resolveOkasNames,
  searchAuthorities,
  getTenderAnnouncements,
  getTenderDetails,
  getTenderDocumentUrl,
  searchDirectProcurementAuthorities,
  searchDirectProcurementParentAuthorities,
  searchDirectProcurements,
  getDirectProcurementDetails,
};
