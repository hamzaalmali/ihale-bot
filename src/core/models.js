// Port of ihale_models.py — Static data tables for EKAP v2 and ilan.gov.tr

const TENDER_TYPES = [
  { id: 1, code: '1', description: 'Mal (Goods/Equipment procurement)' },
  { id: 2, code: '2', description: 'Yapım (Construction/Infrastructure projects)' },
  { id: 3, code: '3', description: 'Hizmet (Services procurement)' },
  { id: 4, code: '4', description: 'Danışmanlık (Consultancy services)' },
];

const TENDER_STATUSES = [
  { id: 1, code: '1', description: 'İptal Edilmiş (Cancelled)' },
  { id: 2, code: '2', description: 'Teklifler Değerlendiriliyor (Bids under evaluation)' },
  { id: 3, code: '3', description: 'Teklif Vermeye Açık (Open for bidding)' },
  { id: 4, code: '4', description: 'Teklif Değerlendirme Tamamlanmış (Bid evaluation completed)' },
  { id: 5, code: '5', description: 'Sözleşme İmzalanmış (Contract signed)' },
];

const TENDER_METHODS = [
  { code: 'Açık', description: 'Açık İhale Usulü (Open tender method)' },
  { code: 'Belli İstekliler Arasında', description: 'Belli İstekliler Arasında İhale (Restricted tender)' },
  { code: 'Pazarlık', description: 'Pazarlık Usulü (Negotiated procedure)' },
  { code: 'Tasarım Yarışması', description: 'Tasarım Yarışması (Design competition)' },
];

// Plate number (1-81) → EKAP API province ID (245-325)
const PLATE_TO_API_ID = {
  1: 245, 2: 246, 3: 247, 4: 248, 5: 250, 6: 251, 7: 252, 8: 254, 9: 255, 10: 256,
  11: 260, 12: 261, 13: 262, 14: 263, 15: 264, 16: 265, 17: 266, 18: 267, 19: 268, 20: 269,
  21: 270, 22: 272, 23: 273, 24: 274, 25: 275, 26: 276, 27: 277, 28: 278, 29: 279, 30: 280,
  31: 281, 32: 283, 33: 302, 34: 284, 35: 285, 36: 289, 37: 290, 38: 291, 39: 293, 40: 294,
  41: 296, 42: 297, 43: 298, 44: 299, 45: 300, 46: 286, 47: 301, 48: 303, 49: 304, 50: 305,
  51: 306, 52: 307, 53: 309, 54: 310, 55: 311, 56: 312, 57: 313, 58: 314, 59: 317, 60: 318,
  61: 319, 62: 320, 63: 315, 64: 321, 65: 322, 66: 324, 67: 325, 68: 249, 69: 259, 70: 288,
  71: 292, 72: 258, 73: 316, 74: 257, 75: 253, 76: 282, 77: 323, 78: 287, 79: 295, 80: 308, 81: 271,
};

const PROVINCES = {
  245: 'ADANA', 246: 'ADIYAMAN', 247: 'AFYONKARAHİSAR', 248: 'AĞRI', 249: 'AKSARAY',
  250: 'AMASYA', 251: 'ANKARA', 252: 'ANTALYA', 253: 'ARDAHAN', 254: 'ARTVİN',
  255: 'AYDIN', 256: 'BALIKESİR', 257: 'BARTIN', 258: 'BATMAN', 259: 'BAYBURT',
  260: 'BİLECİK', 261: 'BİNGÖL', 262: 'BİTLİS', 263: 'BOLU', 264: 'BURDUR',
  265: 'BURSA', 266: 'ÇANAKKALE', 267: 'ÇANKIRI', 268: 'ÇORUM', 269: 'DENİZLİ',
  270: 'DİYARBAKIR', 271: 'DÜZCE', 272: 'EDİRNE', 273: 'ELAZIĞ', 274: 'ERZİNCAN',
  275: 'ERZURUM', 276: 'ESKİŞEHİR', 277: 'GAZİANTEP', 278: 'GİRESUN', 279: 'GÜMÜŞHANE',
  280: 'HAKKARİ', 281: 'HATAY', 282: 'IĞDIR', 283: 'ISPARTA', 284: 'İSTANBUL',
  285: 'İZMİR', 286: 'KAHRAMANMARAŞ', 287: 'KARABÜK', 288: 'KARAMAN', 289: 'KARS',
  290: 'KASTAMONU', 291: 'KAYSERİ', 292: 'KIRIKKALE', 293: 'KIRKLARELİ', 294: 'KIRŞEHİR',
  295: 'KİLİS', 296: 'KOCAELİ', 297: 'KONYA', 298: 'KÜTAHYA', 299: 'MALATYA',
  300: 'MANİSA', 301: 'MARDİN', 302: 'MERSİN', 303: 'MUĞLA', 304: 'MUŞ',
  305: 'NEVŞEHİR', 306: 'NİĞDE', 307: 'ORDU', 308: 'OSMANİYE', 309: 'RİZE',
  310: 'SAKARYA', 311: 'SAMSUN', 312: 'SİİRT', 313: 'SİNOP', 314: 'SİVAS',
  315: 'ŞANLIURFA', 316: 'ŞIRNAK', 317: 'TEKİRDAĞ', 318: 'TOKAT', 319: 'TRABZON',
  320: 'TUNCELİ', 321: 'UŞAK', 322: 'VAN', 323: 'YALOVA', 324: 'YOZGAT', 325: 'ZONGULDAK',
};

const PROPOSAL_TYPES = {
  1: 'Götürü-Anahtar Teslimi Götürü',
  2: 'Birim Fiyat',
  3: 'Karma',
};

const ANNOUNCEMENT_TYPES = {
  1: 'Ön İlan',
  2: 'İhale İlanı',
  3: 'Sonuç İlanı',
  4: 'İptal İlanı',
  5: 'Ön Yeterlik İlanı',
  6: 'Düzeltme İlanı',
};

const ANNOUNCEMENT_TYPE_CODE_MAP = {
  '1': 'Ön İlan',
  '2': 'İhale İlanı',
  '3': 'İptal İlanı',
  '4': 'Sonuç İlanı',
  '5': 'Ön Yeterlik İlanı',
  '6': 'Düzeltme İlanı',
};

const DIRECT_PROCUREMENT_TYPES = {
  1: 'Mal',
  2: 'Yapım',
  3: 'Hizmet',
  4: 'Danışmanlık',
};

const DIRECT_PROCUREMENT_STATUSES = {
  202: 'Doğrudan Temin Duyurusu Yayımlanmış',
  3: 'Teklifler Değerlendiriliyor',
  4: 'Doğrudan Temin Sonuçlandırıldı',
  5: 'Sonuç Bilgileri Gönderildi',
  15: 'Sonuç Duyurusu Yayımlanmış',
};

const DIRECT_PROCUREMENT_STATUS_ALIASES = {
  'doğrudan temin duyurusu': 202,
  'doğrudan temin duyurusu yayımlanmış': 202,
  'teklifler değerlendiriliyor': 3,
  'doğrudan temin sonuçlandırıldı': 4,
  'sonuç bilgileri gönderildi': 5,
  'sonuç duyurusu': 15,
  'sonuç duyurusu yayımlanmış': 15,
};

const DIRECT_PROCUREMENT_SCOPES = {
  101: '4734 Kapsamında',
  102: 'İstisna',
  103: 'Kapsam Dışı',
};

const DIRECT_PROCUREMENT_SCOPE_ALIASES = {
  '4734 kapsaminda': 101,
  '4734 kapsamında': 101,
  istisna: 102,
  'kapsam dışı': 103,
  'kapsam disi': 103,
};

const NAME_TO_PLATE = {};
for (const [plateStr, apiId] of Object.entries(PLATE_TO_API_ID)) {
  const name = PROVINCES[apiId];
  if (name) NAME_TO_PLATE[name.toUpperCase()] = Number(plateStr);
}

// ilan.gov.tr
const ILAN_CITY_IDS = {
  ADANA: 10, ADIYAMAN: 11, 'AFYONKARAHİSAR': 12, 'AĞRI': 13, AKSARAY: 14, AMASYA: 15,
  ANKARA: 16, ANTALYA: 17, 'ARDAHAN': 18, 'ARTVİN': 19, AYDIN: 20, 'BALIKESİR': 21,
  BARTIN: 22, BATMAN: 23, BAYBURT: 24, 'BİLECİK': 25, 'BİNGÖL': 26, 'BİTLİS': 27,
  BOLU: 28, BURDUR: 29, BURSA: 30, 'ÇANAKKALE': 31, 'ÇANKIRI': 32, 'ÇORUM': 33,
  'DENİZLİ': 34, 'DİYARBAKIR': 35, 'DÜZCE': 36, 'EDİRNE': 37, 'ELAZIĞ': 38, 'ERZİNCAN': 39,
  ERZURUM: 40, 'ESKİŞEHİR': 41, GAZİANTEP: 42, 'GİRESUN': 43, 'GÜMÜŞHANE': 44, 'HAKKARİ': 45,
  HATAY: 46, 'IĞDIR': 47, ISPARTA: 48, 'İSTANBUL': 49, 'İZMİR': 50, 'KAHRAMANMARAŞ': 51,
  'KARABÜK': 52, KARAMAN: 53, KARS: 54, KASTAMONU: 55, 'KAYSERİ': 56, 'KİLİS': 57,
  KIRIKKALE: 58, 'KIRKLARELİ': 59, 'KIRŞEHİR': 60, 'KOCAELİ': 61, KONYA: 62, 'KÜTAHYA': 63,
  MALATYA: 64, 'MANİSA': 65, 'MARDİN': 66, 'MERSİN': 67, 'MUĞLA': 68, 'MUŞ': 69,
  'NEVŞEHİR': 70, 'NİĞDE': 71, ORDU: 72, OSMANİYE: 73, 'RİZE': 74, SAKARYA: 75,
  SAMSUN: 76, 'ŞANLIURFA': 77, 'SİİRT': 78, 'SİNOP': 79, 'ŞIRNAK': 80, 'SİVAS': 81,
  'TEKİRDAĞ': 82, TOKAT: 83, TRABZON: 84, 'TUNCELİ': 85, 'UŞAK': 86, VAN: 87,
  YALOVA: 88, YOZGAT: 89, ZONGULDAK: 90,
};

const ILAN_AD_TYPES = {
  'İCRA': 2,
  'İHALE': 3,
  'TEBLİGAT': 4,
  PERSONEL: 5,
};

const ILAN_AD_SOURCES = {
  UYAP: 'UYAP',
  BIK: 'BIK',
};

const PLATE_TO_ILAN_CITY_ID = {
  1: 10, 2: 11, 3: 12, 4: 13, 68: 14, 5: 15, 6: 16, 7: 17, 75: 18, 8: 19,
  9: 20, 10: 21, 74: 22, 72: 23, 69: 24, 11: 25, 12: 26, 13: 27, 14: 28, 15: 29,
  16: 30, 17: 31, 18: 32, 19: 33, 20: 34, 21: 35, 81: 36, 22: 37, 23: 38, 24: 39,
  25: 40, 26: 41, 27: 42, 28: 43, 29: 44, 30: 45, 31: 46, 76: 47, 32: 48, 34: 49,
  35: 50, 46: 51, 78: 52, 70: 53, 36: 54, 37: 55, 38: 56, 79: 57, 71: 58, 39: 59,
  40: 60, 41: 61, 42: 62, 43: 63, 44: 64, 45: 65, 47: 66, 33: 67, 48: 68, 49: 69,
  50: 70, 51: 71, 52: 72, 80: 73, 53: 74, 54: 75, 55: 76, 63: 77, 56: 78, 57: 79,
  73: 80, 58: 81, 59: 82, 60: 83, 61: 84, 62: 85, 64: 86, 65: 87, 77: 88, 66: 89, 67: 90,
};

module.exports = {
  TENDER_TYPES, TENDER_STATUSES, TENDER_METHODS,
  PLATE_TO_API_ID, PROVINCES, PROPOSAL_TYPES,
  ANNOUNCEMENT_TYPES, ANNOUNCEMENT_TYPE_CODE_MAP,
  DIRECT_PROCUREMENT_TYPES, DIRECT_PROCUREMENT_STATUSES,
  DIRECT_PROCUREMENT_STATUS_ALIASES, DIRECT_PROCUREMENT_SCOPES,
  DIRECT_PROCUREMENT_SCOPE_ALIASES, NAME_TO_PLATE,
  ILAN_CITY_IDS, ILAN_AD_TYPES, ILAN_AD_SOURCES, PLATE_TO_ILAN_CITY_ID,
};
