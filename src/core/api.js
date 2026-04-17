// Port of ihale_mcp.py — High-level tool functions
const ekap = require('./ekapClient');
const ilan = require('./ilanClient');
const {
  PLATE_TO_API_ID,
  PLATE_TO_ILAN_CITY_ID,
  ILAN_AD_TYPES,
  ILAN_AD_SOURCES,
} = require('./models');

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function searchTenders(args = {}) {
  let limit = args.limit ?? 10;
  if (limit > 100) limit = 100;
  if (limit < 1) limit = 1;

  let announcementDateStart = args.announcementDateStart ?? null;
  let announcementDateEnd = args.announcementDateEnd ?? null;
  let tenderDateStart = args.tenderDateStart ?? null;
  let tenderDateEnd = args.tenderDateEnd ?? null;

  if (args.announcementDateFilter === 'today') {
    const t = ymd(new Date());
    announcementDateStart = t;
    announcementDateEnd = t;
  }
  if (args.tenderDateFilter === 'from_today') {
    tenderDateStart = ymd(new Date());
    tenderDateEnd = null;
  }

  // Resolve OKAS names if missing
  let okasNames = args.okasNames;
  if (args.okasCodes && args.okasCodes.length && (!okasNames || !okasNames.length)) {
    try {
      okasNames = await ekap.resolveOkasNames(args.okasCodes);
    } catch (_) {
      okasNames = [];
    }
  }

  // Convert plate numbers to API IDs
  let apiProvinceIds = null;
  if (args.provinces && args.provinces.length) {
    apiProvinceIds = args.provinces.map((p) => PLATE_TO_API_ID[p]).filter(Boolean);
    if (!apiProvinceIds.length) apiProvinceIds = null;
  }

  const result = await ekap.searchTenders({
    searchText: args.searchText || '',
    iknYear: args.iknYear ?? null,
    iknNumber: args.iknNumber ?? null,
    tenderTypes: args.tenderTypes || null,
    tenderDateStart,
    tenderDateEnd,
    announcementDateStart,
    announcementDateEnd,
    searchType: args.searchType || 'GirdigimGibi',
    orderBy: args.orderBy || 'ihaleTarihi',
    sortOrder: args.sortOrder || 'desc',
    eIhale: args.eIhale ?? null,
    eEksiltmeYapilacakMi: args.eEksiltmeYapilacakMi ?? null,
    ortakAlimMi: args.ortakAlimMi ?? null,
    kismiTeklifMi: args.kismiTeklifMi ?? null,
    fiyatDisiUnsurVarmi: args.fiyatDisiUnsurVarmi ?? null,
    ekonomikMaliYeterlilikBelgeleriIsteniyorMu: args.ekonomikMaliYeterlilikBelgeleriIsteniyorMu ?? null,
    meslekiTeknikYeterlilikBelgeleriIsteniyorMu: args.meslekiTeknikYeterlilikBelgeleriIsteniyorMu ?? null,
    isDeneyimiGosterenBelgelerIsteniyorMu: args.isDeneyimiGosterenBelgelerIsteniyorMu ?? null,
    yerliIstekliyeFiyatAvantajiUygulaniyorMu: args.yerliIstekliyeFiyatAvantajiUygulaniyorMu ?? null,
    yabanciIsteklilereIzinVeriliyorMu: args.yabanciIsteklilereIzinVeriliyorMu ?? null,
    alternatifTeklifVerilebilirMi: args.alternatifTeklifVerilebilirMi ?? null,
    konsorsiyumKatilabilirMi: args.konsorsiyumKatilabilirMi ?? null,
    altYukleniciCalistirilabilirMi: args.altYukleniciCalistirilabilirMi ?? null,
    fiyatFarkiVerilecekMi: args.fiyatFarkiVerilecekMi ?? null,
    avansVerilecekMi: args.avansVerilecekMi ?? null,
    cerceveAnlasmasiMi: args.cerceveAnlasmasiMi ?? null,
    personelCalistirilmasinaDayaliMi: args.personelCalistirilmasinaDayaliMi ?? null,
    provinces: apiProvinceIds,
    tenderStatuses: args.tenderStatuses || null,
    tenderMethods: args.tenderMethods || null,
    tenderSubMethods: args.tenderSubMethods || null,
    okasCodes: args.okasCodes || null,
    okasNames: okasNames || null,
    authorityIds: args.authorityIds || null,
    proposalTypes: args.proposalTypes || null,
    announcementTypes: args.announcementTypes || null,
    searchInIkn: args.searchInIkn ?? true,
    searchInTitle: args.searchInTitle ?? true,
    searchInAnnouncement: args.searchInAnnouncement ?? true,
    searchInTechSpec: args.searchInTechSpec ?? true,
    searchInAdminSpec: args.searchInAdminSpec ?? true,
    searchInSimilarWork: args.searchInSimilarWork ?? true,
    searchInLocation: args.searchInLocation ?? true,
    searchInNatureQuantity: args.searchInNatureQuantity ?? true,
    searchInTenderInfo: args.searchInTenderInfo ?? true,
    searchInContractDraft: args.searchInContractDraft ?? true,
    searchInBidForm: args.searchInBidForm ?? true,
    skip: args.skip ?? 0,
    limit,
  });

  if (!result.search_params) {
    result.search_params = {
      search_text: args.searchText || '',
      ikn_year: args.iknYear ?? null,
      ikn_number: args.iknNumber ?? null,
      tender_types: args.tenderTypes || null,
      date_range: {
        tender_start: tenderDateStart,
        tender_end: tenderDateEnd,
        announcement_start: announcementDateStart,
        announcement_end: announcementDateEnd,
      },
    };
  }
  return result;
}

async function searchOkasCodes(args = {}) {
  return ekap.searchOkasCodes({
    searchTerm: args.searchTerm || '',
    kalemTuru: args.kalemTuru ?? null,
    limit: args.limit ?? 50,
  });
}

async function searchAuthorities(args = {}) {
  return ekap.searchAuthorities({
    searchTerm: args.searchTerm || '',
    limit: args.limit ?? 50,
  });
}

async function getRecentTenders({ days = 7, tenderTypes = null, limit = 20 } = {}) {
  let d = days;
  if (d > 30) d = 30;
  if (d < 1) d = 1;
  const end = new Date();
  const start = new Date(end.getTime() - d * 86400000);
  const result = await ekap.searchTenders({
    searchText: '',
    tenderTypes,
    announcementDateStart: ymd(start),
    announcementDateEnd: ymd(end),
    orderBy: 'ihaleTarihi',
    sortOrder: 'desc',
    limit,
  });
  if (result.error) return result;
  return {
    recent_tenders: result.tenders || [],
    total_count: result.total_count || 0,
    date_range: { start: ymd(start), end: ymd(end), days_back: d },
    filters_applied: { tender_types: tenderTypes, limit },
  };
}

async function getTenderAnnouncements(tenderId) {
  const result = await ekap.getTenderAnnouncements(tenderId);
  if (result.error) return result;
  const announcements = result.announcements || [];
  return {
    announcements,
    total_announcements: result.total_count || 0,
    tender_id: tenderId,
    announcement_types_found: Array.from(new Set(announcements.map((a) => a.type?.description || 'Unknown'))),
  };
}

async function getTenderDetails(tenderId) {
  const result = await ekap.getTenderDetails(tenderId);
  if (result.error) return result;
  return {
    tender_details: result,
    summary: {
      tender_name: result.name,
      ikn: result.ikn,
      status: result.status?.description,
      authority: result.authority?.name,
      location: result.basic_info?.location,
      is_electronic: result.basic_info?.is_electronic,
      characteristics_count: (result.characteristics || []).length,
      okas_codes_count: (result.okas_codes || []).length,
      announcements_count: result.announcements_summary?.total_count || 0,
    },
  };
}

async function searchDirectProcurements(args = {}) {
  return ekap.searchDirectProcurements(args);
}

async function getDirectProcurementDetails(args = {}) {
  return ekap.getDirectProcurementDetails(args);
}

async function searchDirectProcurementAuthorities(args = {}) {
  return ekap.searchDirectProcurementAuthorities(args);
}

async function searchDirectProcurementParentAuthorities(args = {}) {
  return ekap.searchDirectProcurementParentAuthorities(args);
}

async function searchIlanAds(args = {}) {
  let maxResultCount = args.maxResultCount ?? 12;
  if (maxResultCount > 50) maxResultCount = 50;
  if (maxResultCount < 1) maxResultCount = 1;

  let cityId = args.cityId ?? null;
  if (args.cityPlate != null && cityId == null) {
    cityId = PLATE_TO_ILAN_CITY_ID[args.cityPlate];
    if (cityId == null) {
      return {
        error: `Invalid plate number: ${args.cityPlate}. Valid range: 1-81`,
        valid_plates: '1=ADANA, 6=ANKARA, 34=İSTANBUL, 35=İZMİR, etc.',
      };
    }
  }

  let adTypeId = null;
  if (args.adTypeFilter) {
    adTypeId = ILAN_AD_TYPES[String(args.adTypeFilter).toUpperCase()];
    if (adTypeId == null) {
      return { error: `Invalid ad type: ${args.adTypeFilter}`, valid_types: 'İCRA, İHALE, TEBLİGAT, PERSONEL' };
    }
  }

  let adSource = null;
  if (args.adSourceFilter) {
    adSource = ILAN_AD_SOURCES[String(args.adSourceFilter).toUpperCase()];
    if (adSource == null) {
      return { error: `Invalid ad source: ${args.adSourceFilter}`, valid_sources: 'UYAP (E-SATIŞ), BIK (Basın İlan Kurumu)' };
    }
  }

  return ilan.searchAds({
    searchText: args.searchText || '',
    skipCount: args.skipCount ?? 0,
    maxResultCount,
    searchInTitle: !!args.searchInTitle,
    searchInContent: !!args.searchInContent,
    cityId,
    city: args.city ?? null,
    category: args.category ?? null,
    adType: args.adType ?? null,
    adTypeId,
    adSource,
    publishDateMin: args.publishDateMin ?? null,
    publishDateMax: args.publishDateMax ?? null,
    priceMin: args.priceMin ?? null,
    priceMax: args.priceMax ?? null,
    currentPage: args.currentPage ?? 1,
  });
}

async function getIlanAdDetail(adId) {
  return ilan.getAdDetail(adId);
}

module.exports = {
  searchTenders,
  searchOkasCodes,
  searchAuthorities,
  getRecentTenders,
  getTenderAnnouncements,
  getTenderDetails,
  searchDirectProcurements,
  getDirectProcurementDetails,
  searchDirectProcurementAuthorities,
  searchDirectProcurementParentAuthorities,
  searchIlanAds,
  getIlanAdDetail,
};
