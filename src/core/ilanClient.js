// Port of ilan_client.py — ilan.gov.tr API client
const crypto = require('crypto');
const https = require('https');
const { htmlToMarkdown } = require('./html2md');

const BASE_URL = 'https://www.ilan.gov.tr';
const SEARCH_ENDPOINT = '/api/api/services/app/Ad/AdsByFilter';
const DETAIL_ENDPOINT = '/api/api/services/app/AdDetail/GetAdDetail';

const HEADERS = {
  accept: 'text/plain',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'content-type': 'application/json-patch+json',
  expires: 'Sat, 01 Jan 2000 00:00:00 GMT',
  origin: 'https://www.ilan.gov.tr',
  pragma: 'no-cache',
  priority: 'u=1, i',
  referer: 'https://www.ilan.gov.tr/ilan/tum-ilanlar',
  'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'x-request-origin': 'IGT-UI',
  'x-requested-with': 'XMLHttpRequest',
};

const insecureAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

let undiciDispatcher = null;
try {
  const { Agent: UndiciAgent } = require('undici');
  undiciDispatcher = new UndiciAgent({
    connect: { rejectUnauthorized: false },
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000,
  });
} catch (_) {}

async function postJson(endpoint, payload) {
  const res = await fetch(BASE_URL + endpoint, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
    dispatcher: undiciDispatcher,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`ilan.gov.tr ${endpoint} HTTP ${res.status} — ${body.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function getJson(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${endpoint}?${qs}`, {
    method: 'GET',
    headers: HEADERS,
    dispatcher: undiciDispatcher,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`ilan.gov.tr ${endpoint} HTTP ${res.status} — ${body.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── search_ads ──────────────────────────────────────────────────────────────
async function searchAds({
  searchText = '',
  skipCount = 0,
  maxResultCount = 12,
  searchInTitle = false,
  searchInContent = false,
  cityId = null,
  city = null,
  category = null,
  adType = null,
  adTypeId = null, // ats parameter
  adSource = null, // as parameter
  publishDateMin = null,
  publishDateMax = null,
  priceMin = null,
  priceMax = null,
  currentPage = 1,
} = {}) {
  const keys = {};

  if (searchText) {
    if (searchInTitle) keys.t = [searchText];
    else if (searchInContent) keys.c = [searchText];
    else keys.q = [searchText];
  }

  if (cityId !== null && cityId !== undefined) keys.aci = [cityId];
  else if (city) keys.city = [city];

  if (category) keys.category = [category];
  if (adType) keys.adType = [adType];
  if (adTypeId !== null && adTypeId !== undefined) keys.ats = [adTypeId];
  if (adSource) keys.as = [adSource];

  if (publishDateMin) keys.ppdmin = [publishDateMin];
  if (publishDateMax) keys.ppdmax = [publishDateMax];
  if (priceMin !== null && priceMin !== undefined) keys.prmin = [String(priceMin)];
  if (priceMax !== null && priceMax !== undefined) keys.prmax = [String(priceMax)];

  let finalSkipCount = skipCount;
  if (currentPage > 1) {
    keys.currentPage = [currentPage];
    if (finalSkipCount === 0) finalSkipCount = (currentPage - 1) * maxResultCount;
  }

  const payload = { keys, skipCount: finalSkipCount, maxResultCount };

  try {
    const data = await postJson(SEARCH_ENDPOINT, payload);
    const result = data.result || {};
    const ads = result.ads || [];
    const categories = result.categories || [];
    const cityCounts = result.cityCounts || [];
    const numFound = result.numFound || 0;

    const formattedAds = ads.map((ad) => {
      const filterInfo = {};
      for (const f of ad.adTypeFilters || []) filterInfo[f.key || ''] = f.value || '';
      return {
        id: ad.id,
        ad_no: ad.adNo,
        advertiser_name: ad.advertiserName,
        title: ad.title,
        city: ad.addressCityName,
        county: ad.addressCountyName,
        publish_date: ad.publishStartDate,
        url: ad.urlStr,
        full_url: `https://www.ilan.gov.tr${ad.urlStr || ''}`,
        ad_source: ad.adSourceName,
        filter_info: filterInfo,
        is_archived: !!ad.isArchived,
      };
    });

    const formattedCategories = categories.map((c) => ({
      id: c.taxId, name: c.name, slug: c.slug, count: c.count, order: c.orderNo,
    }));
    const formattedCities = cityCounts.map((c) => ({ id: c.id, name: c.key, count: c.count }));

    return {
      ads: formattedAds,
      categories: formattedCategories,
      city_counts: formattedCities,
      total_found: numFound,
      returned_count: formattedAds.length,
      search_params: {
        search_text: searchText,
        search_in_title: searchInTitle,
        search_in_content: searchInContent,
        skip_count: finalSkipCount,
        max_result_count: maxResultCount,
        city_id: cityId,
        city,
        category,
        ad_type: adType,
        ad_type_id: adTypeId,
        ad_source: adSource,
        publish_date_min: publishDateMin,
        publish_date_max: publishDateMax,
        price_min: priceMin,
        price_max: priceMax,
        current_page: currentPage,
      },
    };
  } catch (err) {
    return { error: `API request failed${err.status ? ' with status ' + err.status : ''}`, message: err.message };
  }
}

// ── get_ad_detail ───────────────────────────────────────────────────────────
async function getAdDetail(adId) {
  try {
    const data = await getJson(DETAIL_ENDPOINT, { id: adId });
    if (!data.success) {
      return { error: 'API returned unsuccessful response', message: data.error || 'Unknown error' };
    }
    const result = data.result || {};
    if (!result || !Object.keys(result).length) return { error: 'No detail found', ad_id: adId };

    const html = result.content || '';
    const markdown = htmlToMarkdown(html);

    const categories = (result.categories || []).map((c) => ({
      id: c.taxId, name: c.name, slug: c.slug,
    }));
    const adTypeFilters = (result.adTypeFilters || []).map((f) => ({ key: f.key, value: f.value }));

    return {
      ad_detail: {
        id: result.id,
        ad_no: result.adNo,
        title: result.title,
        content_html: html,
        content_markdown: markdown,
        city: result.addressCityName,
        county: result.addressCountyName,
        advertiser: {
          name: result.advertiserName,
          code: result.advertiserCode,
          logo: result.advertiserLogo,
        },
        source: {
          name: result.adSourceName,
          code: result.adSourceCode,
          logo: result.adSourceLogoPath,
        },
        url: result.urlStr,
        full_url: `https://www.ilan.gov.tr${result.urlStr || ''}`,
        categories,
        filters: adTypeFilters,
        statistics: {
          hit_count: result.hitCount || 0,
          is_archived: !!result.isArchived,
          is_bik: !!result.isBikAd,
        },
      },
      success: true,
    };
  } catch (err) {
    return {
      error: `API request failed${err.status ? ' with status ' + err.status : ''}`,
      message: err.message,
      ad_id: adId,
    };
  }
}

module.exports = { searchAds, getAdDetail };
