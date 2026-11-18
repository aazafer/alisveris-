/* Ev Alışveriş Listesi — kayıtsız, ücretsiz MQTT senkronu */
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_PREFIX = 'ev-alisveris/';
const ROOM_KEY = 'alisveris.room.v2';
const STATE_PREFIX = 'alisveris.state.v2.';
const HIDE_KEY = 'alisveris.hideDone.v1';

const $ = (sel) => document.querySelector(sel);

const el = {
  app: $('#app'),
  roomBadge: $('#room-badge'), sync: $('#sync'), counts: $('#counts'),
  addForm: $('#add-form'), newItem: $('#new-item'),
  list: $('#list'), empty: $('#empty'),
  shareBtn: $('#share-btn'), menuBtn: $('#menu-btn'),
  shareModal: $('#share-modal'), shareLink: $('#share-link'), shareRoom: $('#share-room'),
  copyLink: $('#copy-link'), closeShare: $('#close-share'),
  menuModal: $('#menu-modal'), hideDone: $('#hide-done'), menuShare: $('#menu-share'),
  menuInstall: $('#menu-install'), menuNew: $('#menu-new'), menuClose: $('#menu-close'),
  installBtn: $('#install-btn'), clearDone: $('#clear-done'), toast: $('#toast')
};

let room = null;
let topic = null;
let client = null;
let connected = false;
let connectTimer = null;
let gotMessage = false;
let lastPublishAt = 0;
let items = [];
let signature = '';
let editing = null;
let hideDone = localStorage.getItem(HIDE_KEY) === '1';
let deferredInstall = null;
let toastTimer = null;
const saveTimers = new Map();

/* ── Yardımcılar ───────────────────────────────────── */
function makeId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

function makeRoom() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'EV';
  for (let i = 0; i < 6; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

function setSync(state) {
  const labels = {
    online: 'Canlı', offline: 'Çevrimdışı', connecting: 'Bağlanıyor…', error: 'Bağlantı yok'
  };
  el.sync.className = 'sync ' + state;
  el.sync.querySelector('span').textContent = labels[state] || state;
}

/* ── Oda ve yerel durum ────────────────────────────── */
function readRoom() {
  const u = new URL(location.href);
  const fromUrl = u.searchParams.get('o');
  if (fromUrl && /^[A-Za-z0-9_-]{4,40}$/.test(fromUrl)) {
    room = fromUrl;
  } else {
    room = localStorage.getItem(ROOM_KEY) || makeRoom();
  }
  localStorage.setItem(ROOM_KEY, room);
  topic = TOPIC_PREFIX + room;
  u.searchParams.set('o', room);
  history.replaceState(null, '', u.pathname + u.search);
}

function normalizeItem(x) {
  return {
    id: String(x.id || makeId()),
    name: String(x.name || ''),
    qty: x.qty == null ? '' : String(x.qty),
    priority: ['low', 'normal', 'urgent'].includes(x.priority) ? x.priority : 'normal',
    done: !!x.done,
    deleted: !!x.deleted,
    createdAt: Number(x.createdAt) || 0,
    updatedAt: Number(x.updatedAt) || 0
  };
}

function stateKey(arr) {
  return JSON.stringify(arr.map((i) => [
    i.id, i.name, i.qty, i.priority, i.done, i.deleted, i.createdAt, i.updatedAt
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_PREFIX + room) || '[]');
    items = Array.isArray(raw) ? raw.map(normalizeItem) : [];
  } catch (_) {
    items = [];
  }
}

function saveState() {
  localStorage.setItem(STATE_PREFIX + room, JSON.stringify(items));
}

function visibleItems() {
  return items.filter((i) => !i.deleted).sort((a, b) => a.createdAt - b.createdAt);
}

// İki telefon aynı ürünü aynı milisaniyede düzenlerse zaman damgaları eşit
// olabilir. O durumda "yerel kazanır" kuralı iki cihazı farklı değerde bırakır.
// İçeriğe göre deterministik bir sıralama kullanarak ikisi de aynı kazananı seçer.
function itemKey(it) {
  return [it.name, it.qty, it.priority, it.done ? 1 : 0, it.deleted ? 1 : 0, it.createdAt].join('\u0001');
}

function newer(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return itemKey(a) > itemKey(b);
}

function mergeState(local, remote) {
  const map = new Map();
  for (const it of [...local, ...remote]) {
    const prev = map.get(it.id);
    if (!prev || newer(it, prev)) map.set(it.id, it);
  }
  return [...map.values()];
}

/* ── MQTT ──────────────────────────────────────────── */
function publish() {
  if (client && connected) {
    client.publish(topic, JSON.stringify(items), { qos: 1, retain: true });
    lastPublishAt = Date.now();
  }
}

function onMessage(receivedTopic, payload) {
  if (receivedTopic !== topic) return;
  gotMessage = true;
  let incoming;
  try {
    incoming = JSON.parse(payload.toString());
  } catch (_) { return; }
  if (!Array.isArray(incoming)) return;

  const normalized = incoming.map(normalizeItem);
  const merged = mergeState(items, normalized);
  items = merged;
  saveState();
  paint();
  if (stateKey(merged) !== stateKey(normalized)) publish();
}

function connect() {
  if (client) {
    try { client.end(true); } catch (_) {}
    client = null;
  }
  connected = false;
  gotMessage = false;

  if (!window.mqtt) {
    setSync('error');
    toast('Senkron kütüphanesi yüklenemedi; liste bu telefonda saklanıyor.');
    return;
  }

  setSync('connecting');
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (!connected) {
      setSync('error');
      toast('Broker’a ulaşılamadı; değişiklikler bu telefonda saklanıyor.');
    }
  }, 12000);

  client = window.mqtt.connect(BROKER, {
    clientId: 'web-' + makeId(),
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    keepalive: 30
  });

  client.on('connect', () => {
    connected = true;
    clearTimeout(connectTimer);
    setSync('online');
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        toast('Liste aboneliği kurulamadı');
        return;
      }
      // Broker retained mesajı kaybettiyse (örn. restart) yerel listeyi geri koy.
      setTimeout(() => {
        if (connected && !gotMessage) publish();
      }, 1500);
    });
  });

  client.on('message', onMessage);
  client.on('reconnect', () => { connected = false; setSync('connecting'); });
  client.on('offline', () => { connected = false; setSync('offline'); });
  client.on('close', () => { connected = false; setSync('offline'); });
  client.on('error', (err) => {
    console.error(err);
    setSync('error');
  });
}

/* ── Görünüm ───────────────────────────────────────── */
function updateCounts(shown) {
  const active = shown.filter((i) => !i.done);
  const urgent = active.filter((i) => i.priority === 'urgent').length;
  el.counts.textContent = `${active.length} ürün` + (urgent ? ` · ${urgent} acil` : '');
}

function rowHTML(i) {
  const prios = [['low', 'Önemsiz'], ['normal', 'Normal'], ['urgent', 'Acil']];
  return `
  <article class="item priority-${i.priority}${i.done ? ' done' : ''}" data-id="${esc(i.id)}">
    <div class="item-main">
      <button type="button" class="check" data-act="check" aria-pressed="${i.done}"
              aria-label="${i.done ? 'Alınmadı olarak işaretle' : 'Alındı olarak işaretle'}">✓</button>
      <input class="item-name" data-field="name" data-id="${esc(i.id)}"
             value="${esc(i.name)}" maxlength="120" aria-label="Ürün adı">
      <label class="qty-wrap">
        <span>MİKTAR</span>
        <input class="item-qty" data-field="qty" data-id="${esc(i.id)}"
               value="${esc(i.qty)}" placeholder="miktar" maxlength="24" inputmode="text" aria-label="Miktar">
      </label>
      <button type="button" class="delete" data-act="delete" aria-label="Sil">✕</button>
    </div>
    <div class="priorities" role="group" aria-label="Öncelik">
      ${prios.map(([value, label]) => `
        <button type="button" class="p-btn${i.priority === value ? ' active' : ''}"
                data-act="priority" data-priority="${value}" aria-pressed="${i.priority === value}">${label}</button>`).join('')}
    </div>
  </article>`;
}

function captureFocus() {
  const a = document.activeElement;
  if (!a || !el.list.contains(a) || !a.dataset || !a.dataset.id || !a.dataset.field) return null;
  return { id: a.dataset.id, field: a.dataset.field, start: a.selectionStart, end: a.selectionEnd };
}

function restoreFocus(f) {
  if (!f) return;
  const target = el.list.querySelector(
    `[data-id="${CSS.escape(f.id)}"][data-field="${CSS.escape(f.field)}"]`
  );
  if (!target) return;
  target.focus({ preventScroll: true });
  try { if (f.start != null) target.setSelectionRange(f.start, f.end); } catch (_) {}
}

function paint() {
  const shown = visibleItems();
  updateCounts(shown);
  el.empty.hidden = shown.length > 0;

  const sig = JSON.stringify(shown.map((i) => (
    editing && editing.id === i.id
      ? [i.id, '@', i.priority, i.done]
      : [i.id, i.name, i.qty, i.priority, i.done]
  )));
  if (sig === signature) return;

  const focus = captureFocus();
  el.list.innerHTML = shown.map(rowHTML).join('');
  signature = sig;
  restoreFocus(focus);
}

/* ── Değişiklikler ─────────────────────────────────── */
function commit() {
  saveState();
  paint();
  publish();
}

function updateItem(id, patch) {
  const item = items.find((x) => x.id === id);
  if (!item || item.deleted) return;
  Object.assign(item, patch, { updatedAt: Date.now() });
  commit();
}

function scheduleSave(id, field, value) {
  const key = id + ':' + field;
  clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(() => {
    saveTimers.delete(key);
    updateItem(id, { [field]: value });
  }, 350));
}

function flushSave(id, field, value) {
  const key = id + ':' + field;
  if (!saveTimers.has(key)) return;
  clearTimeout(saveTimers.get(key));
  saveTimers.delete(key);
  updateItem(id, { [field]: value });
}

function addItem(name) {
  const now = Date.now();
  items.push(normalizeItem({
    id: makeId(), name, qty: '', priority: 'normal',
    done: false, deleted: false, createdAt: now, updatedAt: now
  }));
  commit();
}

function deleteItem(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;
  item.deleted = true;
  item.updatedAt = Date.now();
  commit();
}

/* ── Arayüz olayları ───────────────────────────────── */
function openModal(node) { node.hidden = false; }
function closeModals() { document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; }); }

function shareLink() {
  return location.origin + location.pathname + '?o=' + room;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}

function askInstall() {
  closeModals();
  if (deferredInstall) {
    deferredInstall.prompt();
    deferredInstall = null;
    return;
  }
  openModal(el.menuModal);
  toast('Tarayıcı menüsünden “Ana ekrana ekle”yi seçin.');
}

function wireEvents() {
  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.newItem.value.trim();
    if (!name) return;
    addItem(name);
    el.newItem.value = '';
    el.newItem.focus();
  });

  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = btn.closest('.item');
    if (!row) return;
    const id = row.dataset.id;
    const item = items.find((x) => x.id === id);
    if (!item) return;

    if (btn.dataset.act === 'check') updateItem(id, { done: !item.done });
    else if (btn.dataset.act === 'delete') deleteItem(id);
    else if (btn.dataset.act === 'priority') updateItem(id, { priority: btn.dataset.priority });
  });

  el.list.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.field || !t.dataset.id) return;
    scheduleSave(t.dataset.id, t.dataset.field, t.value);
  });

  el.list.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.field && t.dataset.id) {
      editing = { id: t.dataset.id, field: t.dataset.field };
    }
  });

  el.list.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.field || !t.dataset.id) return;
    flushSave(t.dataset.id, t.dataset.field, t.value);
    if (editing && editing.id === t.dataset.id) editing = null;
  });

  el.clearDone.addEventListener('click', () => {
    const done = items.filter((i) => !i.deleted && i.done);
    if (!done.length) { toast('Alınan ürün yok'); return; }
    if (!confirm(`${done.length} alınan ürün silinsin mi?`)) return;
    const now = Date.now();
    done.forEach((i) => { i.deleted = true; i.updatedAt = now; });
    commit();
  });

  el.shareBtn.addEventListener('click', () => {
    el.shareLink.textContent = shareLink();
    el.shareRoom.textContent = room;
    openModal(el.shareModal);
  });
  el.closeShare.addEventListener('click', closeModals);
  el.copyLink.addEventListener('click', async () => {
    const ok = await copyText(shareLink());
    toast(ok ? 'Bağlantı kopyalandı' : 'Kopyalanamadı, bağlantıyı elle seçin');
  });

  el.menuBtn.addEventListener('click', () => openModal(el.menuModal));
  el.menuClose.addEventListener('click', closeModals);
  el.menuShare.addEventListener('click', async () => {
    const ok = await copyText(shareLink());
    toast(ok ? 'Bağlantı kopyalandı' : 'Kopyalanamadı');
  });
  el.menuInstall.addEventListener('click', askInstall);
  el.installBtn.addEventListener('click', askInstall);

  el.hideDone.addEventListener('change', () => {
    hideDone = el.hideDone.checked;
    localStorage.setItem(HIDE_KEY, hideDone ? '1' : '0');
    signature = '';
    paint();
  });

  el.menuNew.addEventListener('click', () => {
    if (!confirm('Yeni bir liste oluşturulsun mu? Bu telefonun mevcut listesi sıfırlanır, eski bağlantı başka telefonlarda çalışmaya devam eder.')) return;
    room = makeRoom();
    localStorage.setItem(ROOM_KEY, room);
    topic = TOPIC_PREFIX + room;
    items = [];
    signature = '';
    saveState();
    const u = new URL(location.href);
    u.searchParams.set('o', room);
    history.replaceState(null, '', u.pathname + u.search);
    el.roomBadge.textContent = room;
    paint();
    closeModals();
    connect();
    toast('Yeni liste hazır; bağlantıyı paylaşabilirsiniz.');
  });

  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModals(); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModals();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    el.installBtn.hidden = false;
  });
  window.addEventListener('online', () => { if (!connected) setSync('connecting'); });
  window.addEventListener('offline', () => { connected = false; setSync('offline'); });
}

/* ── Başlat ────────────────────────────────────────── */
function boot() {
  window.__alisverisBooted = true;
  readRoom();
  loadState();
  el.roomBadge.textContent = room;
  el.hideDone.checked = hideDone;
  wireEvents();
  paint();
  connect();

  // Dakikada bir retained mesajı tazele; broker veriyi düşürürse geri gelsin.
  setInterval(() => {
    if (connected && Date.now() - lastPublishAt > 50000) publish();
  }, 60000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
