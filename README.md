# Baratoprak Enerji · İhale Bot

EKAP v2 portalından (ve ilan.gov.tr'den) periyodik olarak ihale taraması yapan,
verdiğiniz anahtar kelimelerle eşleşen yeni ihaleleri WhatsApp üzerinden bildiren
**Baratoprak Enerji** için özel Electron tabanlı masaüstü uygulama.

- WhatsApp tarafı `@wppconnect-team/wppconnect` ile arka planda çalışır.
- Yeni sürümler GitHub Releases üzerinden **otomatik** dağıtılır; uygulama
  açılışta ve her 4 saatte bir kontrol eder, yeni sürüm varsa sessizce indirip
  kullanıcıya "Yeniden Başlat & Kur" butonu sunar.

## İçindekiler

1. [Geliştirme](#geliştirme)
2. [Paketleme (exe / dmg / AppImage)](#paketleme)
3. [GitHub üzerinden otomatik güncelleme](#github-üzerinden-otomatik-güncelleme)
4. [Kullanım](#kullanım)
5. [Mimari](#mimari)

## Geliştirme

```bash
cd /Users/hamza/Desktop/ihale_deneme
npm install
npm start
```

Not: Dev modunda (`npm start`) otomatik güncelleme **devre dışıdır**.
`electron-updater` yalnızca paketlenmiş uygulamada aktif olur.

## Paketleme

```bash
npm run dist        # geçerli platformu paketle (installer üretir)
npm run pack        # installer üretmeden (test için)
npm run dist:win    # Windows NSIS installer + portable
npm run dist:mac    # macOS DMG (arm64 + x64 universal)
npm run dist:linux  # Linux AppImage
```

Çıktı `dist/` altına düşer. Windows için iki hedef:

- `BaratoprakEnerji-IhaleBot-Setup-1.0.0.exe` — NSIS installer (varsayılan)
- `BaratoprakEnerji-IhaleBot-Setup-1.0.0-portable.exe` — portable

> Otomatik güncelleme için **NSIS installer** gerekir; portable exe kendini
> güncelleyemez.

## GitHub üzerinden otomatik güncelleme

`electron-updater`, GitHub Releases'i backend olarak kullanır. Akış:

```
1. package.json'daki versiyonu yükselt      (1.0.0 → 1.0.1)
2. Commit + tag + push                       (git tag v1.0.1)
3. npm run release:win                       (ya da release:mac, release)
4. electron-builder artifacts'ı GitHub Release'e yükler, taslak release oluşturur
5. GitHub'dan release'i "Publish" edin
6. Açık olan kullanıcı uygulamaları birkaç dakika içinde güncellemeyi algılar
```

### Tek seferlik kurulum

#### 1) GitHub reposu

Boş bir repo açın — tercihen **public** (private da olur ama `electron-updater`
için ek token işlemesi gerekir).

Varsayılan olarak `package.json` şu repo'yu bekliyor:

```json
"publish": [{ "provider": "github", "owner": "BaratoprakEnerji", "repo": "ihale-bot" }]
```

Kendi repo'nuz farklıysa `package.json` → `build.publish` ve `repository.url`
alanlarını güncelleyin.

#### 2) Personal Access Token

GitHub'da Settings → Developer settings → **Personal access tokens (classic)**:

- Scopes: `repo` (public repo için `public_repo` yeterli).
- Token'ı kopyalayın.

Her release öncesi terminalde export edin (ya da .env dosyasına koyun):

```bash
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

> Token'ı repo'ya commit etmeyin. `.gitignore` zaten `node_modules`, `dist`
> vs. hariç tutuyor.

#### 3) İlk release

```bash
# version bump
npm version patch            # 1.0.0 → 1.0.1, tag da oluşturur

# push commit + tag
git push && git push --tags

# build + GitHub'a yükle
npm run release:win          # Windows için
```

Komut `dist/` altına artifact'ları üretir ve GitHub'daki `v1.0.1` tag'ine
**taslak** release olarak yükler. Yüklenen dosyalar:

- `BaratoprakEnerji-IhaleBot-Setup-1.0.1.exe`
- `BaratoprakEnerji-IhaleBot-Setup-1.0.1.exe.blockmap`
- `latest.yml`  ← electron-updater bu dosyayı okur

GitHub → Releases sayfasından taslak release'i **Publish** edin. Yayınlanınca
çalışan uygulamalar maksimum 4 saat içinde güncellemeyi fark eder
(ya da kullanıcı menüden "Güncelleme Kontrol Et"e bastığında anında).

#### 4) Sonraki release'ler

Aynı 4 adım: version bump → push → `npm run release:win` → Publish.

### Kullanıcı tarafı deneyim

- Uygulama açılır, 2 sn sonra sessizce kontrol başlar.
- Yeni sürüm varsa üstte yeşil **"Yeni sürüm hazırlanıyor"** bandı belirir.
- Otomatik indirme başlar, ilerleme çubuğu görünür.
- İndirme bittiğinde "Yeniden Başlat & Kur" butonu aktif olur.
- Butona basınca uygulama kapanır, yükleyici sessizce çalışır, uygulama
  otomatik olarak tekrar açılır.

Kullanıcı "Gizle"ye basarsa banner kapanır ama indirme arka planda devam eder
— uygulama bir sonraki açılışta güncellemeyi kurar (`autoInstallOnAppQuit`).

### Code signing (önerilir)

#### Windows

İmzasız NSIS installer da güncellenir ama Windows SmartScreen ilk kurulumda
"Bilinmeyen yayımcı" uyarısı verir.

```bash
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=password
export GH_TOKEN=...
npm run release:win
```

#### macOS

İmzasız DMG `Gatekeeper` tarafından bloklanır. Apple Developer hesabı + imza
sertifikası + notarization gereklidir:

```bash
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD=password
npm run release:mac
```

## Kullanım

1. **Ayarlar** sekmesinde anahtar kelimeleri, alıcı WhatsApp numaralarını
   (ülke kodu ile), aralık ve geriye bakma süresini, ihale türü ve il
   filtrelerini doldurun → **Kaydet**.
2. **WhatsApp** sekmesinde **Bağlan** → QR'yi telefondan okutun
   (WhatsApp → Bağlı Cihazlar → Cihaz Bağla).
3. **Gösterge** sekmesinde **İzlemeyi Başlat** veya **Şimdi Tara**.
4. Eşleşen ihaleler WhatsApp alıcılarına mesaj olarak gider ve **Eşleşmeler**
   sekmesinde listelenir. Aynı IKN tekrar bildirilmez.

## Mimari

```
main.js                Electron ana süreç, IPC, auto-updater orkestrasyonu
preload.js             Güvenli köprü (contextIsolation)
src/
├── core/
│   ├── models.js      Sabit tablolar (iller, türler, OKAS, ilan.gov.tr)
│   ├── html2md.js     HTML → Markdown (Turndown)
│   ├── ekapClient.js  EKAP v2 API (AES-192-CBC imza + legacy cookie jar)
│   ├── ilanClient.js  ilan.gov.tr API
│   └── api.js         Üst seviye araç fonksiyonları
├── whatsapp.js        wppconnect sarmalayıcı
├── monitor.js         Periyodik tarama → WhatsApp
├── storage.js         Ayar / görülmüş IKN / eşleşme geçmişi
└── updater.js         electron-updater sarmalayıcı
renderer/              Dashboard UI
build/                 İkonlar (icon.ico / icon.icns / icon.png)
```

Port edilen EKAP/ilan fonksiyonları (`src/core/api.js`):

- `searchTenders` (17+ boolean filtre, OKAS, il plaka, tarih aralığı)
- `searchOkasCodes`, `resolveOkasNames`, `searchAuthorities`, `getRecentTenders`
- `getTenderAnnouncements`, `getTenderDetails` (HTML → Markdown)
- `searchDirectProcurements`, `getDirectProcurementDetails` (+ yetki arama)
- `searchIlanAds`, `getIlanAdDetail`

## Veri Konumları

Yapılandırma, WhatsApp oturumu ve eşleşme geçmişi kullanıcı veri klasöründe
tutulur:

- macOS: `~/Library/Application Support/Baratoprak Enerji İhale Bot/`
- Windows: `%APPDATA%/Baratoprak Enerji İhale Bot/`

İçerik: `config.json`, `seen.json`, `matches.json`, `wa-tokens/`.

## Dikkat / Yasal

- WhatsApp Web üçüncü parti istemcileri resmi olarak desteklemez. Toplu /
  ticari gönderimlerde WhatsApp Business API tercih edin.
- EKAP rate limit'ine uyun; 5 dakikadan kısa tarama aralığı tanımlamayın.
- AES anahtarı EKAP frontend'i değişirse kırılabilir;
  `src/core/ekapClient.js` içindeki `R8_KEY` ve `generateSecurityHeaders()`
  güncellenmelidir.
