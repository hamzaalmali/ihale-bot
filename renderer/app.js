(function () {
'use strict';
const el = (id) => document.getElementById(id);
const on = (id, ev, fn) => {
  const node = el(id);
  if (!node) return;
  node.addEventListener(ev, (e) => {
    try { fn(e); } catch (err) { console.error(`[${id}.${ev}]`, err); }
  });
};
const api = window.api || {};
if (!window.api) {
  console.warn('window.api is undefined — preload çalışmamış olabilir');
  const bar = document.getElementById('errBar');
  if (bar) { bar.hidden = false; bar.textContent = 'preload.js yüklenmedi (window.api yok)'; }
}

const splitList = (s) =>
  String(s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

// ── Config ──────────────────────────────────────────────────────────────────
async function loadConfig() {
  const cfg = await api.getConfig();
  el('keywords').value = (cfg.keywords || []).join(', ');
  el('recipients').value = (cfg.recipients || []).join(', ');
  el('interval').value = cfg.intervalMinutes ?? 30;
  el('lookback').value = cfg.lookbackDays ?? 7;
  el('perKeywordLimit').value = cfg.perKeywordLimit ?? 30;
  const selected = new Set((cfg.tenderTypes || []).map(String));
  for (const opt of el('tenderTypes').options) opt.selected = selected.has(opt.value);
  el('provincePlates').value = (cfg.provincePlates || []).join(', ');
  if (el('searchType')) el('searchType').value = cfg.searchType || 'TumKelimeler';
  if (el('strictTitleMatch')) el('strictTitleMatch').value = String(cfg.strictTitleMatch !== false);
  if (el('blacklist')) el('blacklist').value = (cfg.blacklist || []).join(', ');
  el('template').value = cfg.messageTemplate || '';

  el('statKeywords').textContent = (cfg.keywords || []).length || '0';
  el('statRecipients').textContent = (cfg.recipients || []).length || '0';
}

// Anahtar kelime önerileri
const KEYWORD_PRESETS = {
  elektrik: [
    'scada', 'kontrol panosu', 'og pano', 'ag pano', 'og hücre',
    'transformatör', 'trafo', 'rmu', 'kesici', 'anahtarlama',
    'orta gerilim', 'alçak gerilim', 'modüler hücre', 'kompakt hücre',
    'otomasyon panosu', 'elektrik dağıtım',
  ],
  scada: [
    'scada', 'otomasyon', 'plc', 'hmi', 'rtu', 'uzaktan izleme',
    'enerji izleme', 'scada sistemi', 'kontrol sistemi',
  ],
};
document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.preset;
    const preset = KEYWORD_PRESETS[key] || [];
    const current = splitList(el('keywords').value);
    const merged = Array.from(new Set([...current, ...preset]));
    el('keywords').value = merged.join(', ');
    logLocal(`${preset.length} örnek anahtar kelime eklendi`);
  });
});

on('saveConfig', 'click', async () => {
  const tenderTypes = Array.from(el('tenderTypes').selectedOptions).map((o) => parseInt(o.value, 10));
  const provincePlates = splitList(el('provincePlates').value)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 81);
  const cfg = {
    keywords: splitList(el('keywords').value),
    recipients: splitList(el('recipients').value)
      .map((n) => (n.includes('@') ? n.trim() : n.replace(/\D/g, '')))
      .filter(Boolean),
    intervalMinutes: parseInt(el('interval').value, 10) || 30,
    lookbackDays: parseInt(el('lookback').value, 10) || 7,
    perKeywordLimit: parseInt(el('perKeywordLimit').value, 10) || 30,
    tenderTypes,
    provincePlates,
    searchType: el('searchType')?.value || 'TumKelimeler',
    strictTitleMatch: (el('strictTitleMatch')?.value || 'true') === 'true',
    blacklist: splitList(el('blacklist')?.value || ''),
    messageTemplate: el('template').value,
  };
  await api.setConfig(cfg);
  if (el('statKeywords')) el('statKeywords').textContent = cfg.keywords.length || '0';
  if (el('statRecipients')) el('statRecipients').textContent = cfg.recipients.length || '0';
  logLocal('Ayarlar kaydedildi');
});

// ── WhatsApp controls ───────────────────────────────────────────────────────
on('startWA', 'click', async () => {
  try { await api.startWhatsApp(); }
  catch (e) { alert('WhatsApp başlatılamadı: ' + e.message); }
});
on('stopWA', 'click', () => api.stopWhatsApp && api.stopWhatsApp());
on('sendTest', 'click', async () => {
  try {
    await api.testWhatsApp(el('testNumber').value, el('testText').value || 'test');
    logLocal('Test mesajı gönderildi');
  } catch (e) { alert(e.message); }
});

// ── Monitor controls ────────────────────────────────────────────────────────
on('startMon', 'click', () => api.startMonitor && api.startMonitor());
on('stopMon', 'click', () => api.stopMonitor && api.stopMonitor());
on('runOnce', 'click', () => api.runOnce && api.runOnce());
on('clearSeen', 'click', async () => {
  if (!confirm('Görülmüş ihaleler listesi sıfırlansın mı? Bir sonraki taramada tümü yeniden bildirilebilir.')) return;
  await api.clearSeen();
  logLocal('Görülmüş listesi sıfırlandı');
});
on('refreshMatches', 'click', refreshMatches);
on('refreshMatches2', 'click', refreshMatches);
on('clearLogs', 'click', () => {
  if (el('logBox')) el('logBox').innerHTML = '';
  if (el('logBoxFull')) el('logBoxFull').innerHTML = '';
  if (el('logCount')) el('logCount').textContent = '0 satır';
});
on('matchFilter', 'input', refreshMatches);

// ── Grup seçici ─────────────────────────────────────────────────────────────
on('loadGroups', 'click', async () => {
  const list = el('groupList');
  if (!list) return;
  list.hidden = false;
  list.innerHTML = '<div class="group-empty">Gruplar yükleniyor…</div>';
  try {
    const groups = await api.listGroups();
    if (!groups || !groups.length) {
      list.innerHTML = '<div class="group-empty">Grup bulunamadı. WhatsApp\'a bağlı mısınız?</div>';
      return;
    }
    const current = new Set(splitList(el('recipients').value));
    list.innerHTML = groups
      .map((g) => `
        <label class="group-row">
          <input type="checkbox" value="${esc(g.id)}" ${current.has(g.id) ? 'checked' : ''}>
          <span class="g-name">${esc(g.name)}</span>
          <span class="g-count">${g.participants || '?'} üye</span>
        </label>
      `)
      .join('') +
      `<div class="group-list-actions">
        <button class="btn btn-ghost btn-sm" id="groupCancel">Kapat</button>
        <button class="btn btn-primary btn-sm" id="groupApply">Seçilenleri Ekle</button>
      </div>`;

    el('groupApply').onclick = () => {
      const selected = Array.from(list.querySelectorAll('input[type=checkbox]:checked'))
        .map((c) => c.value);
      const currentList = splitList(el('recipients').value);
      const merged = Array.from(new Set([...currentList, ...selected]));
      el('recipients').value = merged.join(', ');
      list.hidden = true;
      logLocal(`${selected.length} grup alıcı listesine eklendi`);
    };
    el('groupCancel').onclick = () => { list.hidden = true; };
  } catch (err) {
    list.innerHTML = `<div class="group-empty">Hata: ${esc(err.message)}</div>`;
  }
});

// ── Events ──────────────────────────────────────────────────────────────────
if (api.onQR) api.onQR((qr) => {
  if (el('qrArea')) el('qrArea').hidden = false;
  if (el('qrImg')) el('qrImg').src = qr;
});
if (api.onWAStatus) api.onWAStatus((s) => updateWAStatus(s));
if (api.onLog) api.onLog((l) => logEntry(l));
if (api.onMatch) api.onMatch((m) => {
  logLocal(`Yeni eşleşme: ${m.tender?.name || m.ikn}`);
  refreshMatches();
});

// ── Log helpers ─────────────────────────────────────────────────────────────
let logLineCount = 0;
function logEntry({ ts, level, msg }) {
  const t = new Date(ts).toLocaleTimeString('tr-TR');
  for (const boxId of ['logBox', 'logBoxFull']) {
    const box = el(boxId);
    if (!box) continue;
    const line = document.createElement('div');
    line.className = 'log ' + (level || 'info');
    line.textContent = `[${t}] ${msg}`;
    box.prepend(line);
    while (box.childNodes.length > 500) box.removeChild(box.lastChild);
  }
  logLineCount += 1;
  el('logCount').textContent = `${logLineCount} satır`;
}
function logLocal(msg) {
  logEntry({ ts: new Date().toISOString(), level: 'info', msg });
}

// ── WhatsApp/monitor status UI ──────────────────────────────────────────────
const READY_STATUSES = ['isLogged', 'inChat', 'chatsAvailable', 'successChat', 'ready', 'qrReadSuccess', 'CONNECTED'];
const WARN_STATUSES = ['qr-bekliyor', 'starting', 'notLogged', 'INITIALIZING'];
let waReady = false;
function updateWAStatus(s, ready) {
  if (typeof ready === 'boolean') waReady = ready;
  if (el('waStatus')) el('waStatus').textContent = 'durum: ' + s + (waReady ? ' · hazır' : '');
  const chip = el('chipWA');
  if (!chip) return;
  chip.classList.remove('ok', 'warn', 'err');
  const isReady = waReady || READY_STATUSES.includes(s) || String(s).toLowerCase().includes('chat');
  if (isReady) {
    chip.classList.add('ok');
    const qr = el('qrArea'); if (qr) qr.hidden = true;
  }
  else if (WARN_STATUSES.includes(s)) chip.classList.add('warn');
  else if (String(s).startsWith('error')) chip.classList.add('err');
}

function updateMonChip(running) {
  const chip = el('chipMon');
  chip.classList.remove('ok', 'warn', 'err');
  if (running) chip.classList.add('ok');
  else chip.classList.add('warn');
}

// ── Matches ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function refreshMatches() {
  const list = await api.getMatches();
  el('statMatches').textContent = list.length;
  const dayAgo = Date.now() - 86400000;
  el('statMatches24').textContent = list.filter((m) => new Date(m.notifiedAt).getTime() > dayAgo).length;

  const filter = (el('matchFilter')?.value || '').toLowerCase().trim();
  const filtered = filter
    ? list.filter((m) =>
        [m.keyword, m.tender?.name, m.tender?.authority, m.tender?.province, m.ikn]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(filter))
      )
    : list;

  const renderItem = (m, { short }) => {
    const sentOK = (m.sent || []).filter((x) => x.ok).length;
    const sentFail = (m.sent || []).filter((x) => !x.ok).length;
    const badges = [
      `<span class="badge keyword">${esc(m.keyword)}</span>`,
      m.tender?.type?.description ? `<span class="badge">${esc(m.tender.type.description)}</span>` : '',
      m.tender?.province ? `<span class="badge">${esc(m.tender.province)}</span>` : '',
      sentOK ? `<span class="badge ok">${sentOK} gönderildi</span>` : '',
      sentFail ? `<span class="badge err">${sentFail} hata</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="match">
        <div class="title">${esc(m.tender?.name || m.ikn || '(başlıksız)')}</div>
        <div class="meta">${badges}</div>
        <div class="meta">
          ${esc(m.tender?.authority || '-')} · IKN ${esc(m.ikn || '-')} · ${new Date(m.notifiedAt).toLocaleString('tr-TR')}
        </div>
        ${short ? '' : `<pre>${esc(m.message)}</pre>`}
      </div>
    `;
  };

  const full = el('matchBox');
  full.innerHTML = filtered.slice(0, 60).map((m) => renderItem(m, { short: false })).join('') ||
    '<div class="muted small" style="padding:0.5rem">Henüz eşleşme yok.</div>';

  const preview = el('matchPreview');
  preview.innerHTML = list.slice(0, 8).map((m) => renderItem(m, { short: true })).join('') ||
    '<div class="muted small" style="padding:0.5rem">Henüz eşleşme yok.</div>';
}

async function refreshStatuses() {
  const [wa, mon] = await Promise.all([api.whatsappStatus(), api.monitorStatus()]);
  if (wa) updateWAStatus(wa.status || '—', !!wa.ready);
  updateMonChip(!!mon?.running);

  el('statLastRun').textContent = mon?.lastRun
    ? new Date(mon.lastRun).toLocaleTimeString('tr-TR')
    : '—';
  el('statNextRun').textContent = mon?.nextRun
    ? new Date(mon.nextRun).toLocaleTimeString('tr-TR')
    : (mon?.running ? 'sırada…' : '—');
}

// ── Updater ─────────────────────────────────────────────────────────────────
let updateDismissed = false;
function renderUpdate(s) {
  if (!s) return;
  const bar = el('updateBar');
  const title = el('updateTitle');
  const detail = el('updateDetail');
  const progressBar = el('updateProgressBar');
  const installBtn = el('installUpdate');
  if (!bar) return;

  const showBar = ['available', 'downloading', 'downloaded', 'error'].includes(s.stage);
  if (!showBar || (updateDismissed && s.stage !== 'downloaded' && s.stage !== 'error')) {
    bar.hidden = true;
    bar.classList.remove('error');
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('error', s.stage === 'error');

  installBtn.hidden = true;
  progressBar.style.width = (s.progress || 0) + '%';

  if (s.stage === 'available') {
    title.textContent = `Yeni sürüm: v${s.version}`;
    detail.textContent = 'İndiriliyor…';
  } else if (s.stage === 'downloading') {
    title.textContent = `v${s.version ?? ''} indiriliyor`;
    detail.textContent = `%${s.progress || 0}`;
  } else if (s.stage === 'downloaded') {
    title.textContent = `v${s.version} hazır`;
    detail.textContent = 'Yeniden başlatınca kurulacak';
    installBtn.hidden = false;
  } else if (s.stage === 'error') {
    title.textContent = 'Güncelleme hatası';
    const msg = (s.error || '').split('\n')[0].slice(0, 120);
    detail.textContent = msg;
    detail.title = s.error || '';
  }
}

on('installUpdate', 'click', () => api.installUpdate && api.installUpdate());
on('dismissUpdate', 'click', () => { updateDismissed = true; el('updateBar').hidden = true; });
on('checkUpdates', 'click', async () => {
  updateDismissed = false;
  logLocal('Güncelleme kontrolü başlatıldı');
  try {
    const s = await api.checkUpdates();
    if (s?.stage === 'disabled') logLocal('Dev modunda güncelleme devre dışı', 'warn');
  } catch (e) { alert('Kontrol başarısız: ' + e.message); }
});
if (api.onUpdater) api.onUpdater((s) => renderUpdate(s));

async function showVersion() {
  try {
    const v = await api.appVersion();
    const node = el('appVersion');
    if (node) node.textContent = v || '—';
  } catch (_) {}
}

// ── Init ────────────────────────────────────────────────────────────────────
loadConfig();
refreshMatches();
refreshStatuses();
showVersion();
setInterval(refreshStatuses, 5000);
})();

