'use strict';
/**
 * Wall of Content – Server
 *  /         Wall (Bildschirm mit schwebenden Thumbnails)
 *  /station  Fotostation (Handy)
 *  /admin    Admin-Panel
 *  /p/:id    Download-Seite eines Fotos (Ziel des QR-Codes)
 *  /hunt     Color Hunt (Gäste-Handy)
 */
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const QRCode = require('qrcode');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT === '0' ? 0 : Number(process.env.HTTPS_PORT) || 3443;
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOADS = path.join(DATA, 'uploads');
const ASSETS = path.resolve(process.env.ASSETS_DIR || path.join(ROOT, 'assets'));
const ASSET_DIRS = { frames: path.join(ASSETS, 'frames'), backgrounds: path.join(ASSETS, 'backgrounds') };
const MEDIA_DIR = path.join(ASSETS, 'media'); // Bilder/Videos hier erscheinen automatisch auf der Wall
const DB_FILE = path.join(DATA, 'db.json');

const MAX_PHOTO = 12 * 1024 * 1024;
const MAX_MEDIA = Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024;
const MAX_ASSET = 25 * 1024 * 1024;

const MEDIA_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};
const ASSET_TYPES = {
  frames: { 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg' },
  backgrounds: { 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg' },
};
const ASSET_EXT = {
  frames: ['.png', '.webp', '.svg', '.jpg', '.jpeg'],
  backgrounds: ['.png', '.webp', '.svg', '.jpg', '.jpeg'],
};

for (const d of [DATA, UPLOADS, MEDIA_DIR, ...Object.values(ASSET_DIRS)]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ */
/* Einstellungen & Datenbank (JSON-Datei)                              */
/* ------------------------------------------------------------------ */
const SETTINGS = {
  title: { type: 'string', max: 80, def: 'URBAN ART NIGHT 2026' },
  subtitle: { type: 'string', max: 160, def: 'Mach dein Foto an der Fotostation!' },
  accent: { type: 'color', def: '#e10b70' },
  background: { type: 'string', max: 200, def: '' },
  wallMaxItems: { type: 'int', min: 1, max: 120, def: 36 },
  thumbSize: { type: 'int', min: 80, max: 480, def: 200 },
  speed: { type: 'num', min: 0, max: 5, def: 1 },
  imageDuration: { type: 'int', min: 2, max: 120, def: 8 },
  videoSound: { type: 'bool', def: true },
  stationTitle: { type: 'string', max: 80, def: 'Fotostation' },
  stationsEnabled: { type: 'bool', def: true },
  countdown: { type: 'int', min: 0, max: 10, def: 3 },
  shareDefault: { type: 'bool', def: false },
  moderation: { type: 'bool', def: false },
  // Fotofenster bei deckenden Hintergründen (in % der Bildbreite/-höhe), siehe docs/foto-layout.png
  photoX: { type: 'num', min: 0, max: 90, def: 12.4 },
  photoY: { type: 'num', min: 0, max: 90, def: 7.45 },
  photoW: { type: 'num', min: 10, max: 100, def: 75.2 },
  photoH: { type: 'num', min: 10, max: 100, def: 85.1 },
  photoRadius: { type: 'num', min: 0, max: 50, def: 3 },
  huntMinutes: { type: 'int', min: 1, max: 30, def: 5 },
  huntPhotos: { type: 'int', min: 1, max: 10, def: 5 },
  qrTimeout: { type: 'int', min: 10, max: 600, def: 60 },
  retentionHours: { type: 'int', min: 0, max: 8760, def: 0 },
  publicUrl: { type: 'url', def: '' },
};
const newId = () => crypto.randomBytes(9).toString('base64url');
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.def]));

function validateSetting(key, value) {
  const s = SETTINGS[key];
  if (!s) return undefined;
  switch (s.type) {
    case 'string': return typeof value === 'string' ? value.trim().slice(0, s.max) : undefined;
    case 'bool': return typeof value === 'boolean' ? value : undefined;
    case 'int': case 'num': {
      let n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      if (s.type === 'int') n = Math.round(n);
      return Math.min(s.max, Math.max(s.min, n));
    }
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    case 'url': {
      if (value === '') return '';
      if (typeof value !== 'string') return undefined;
      try {
        const u = new URL(value.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
        return u.origin + u.pathname.replace(/\/+$/, '');
      } catch { return undefined; }
    }
  }
  return undefined;
}

const emptyHunt = () => ({ active: false, round: newId(), players: [], winnerId: null, showWinner: false });
let db = { settings: defaults(), items: [], assets: { frames: {}, backgrounds: {} }, hunt: emptyHunt() };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const known = Object.fromEntries(Object.entries(raw.settings || {}).filter(([k]) => Object.hasOwn(SETTINGS, k)));
  db.settings = { ...defaults(), ...known };
  db.hunt = { ...emptyHunt(), ...(raw.hunt || {}) };
  db.items = Array.isArray(raw.items) ? raw.items : [];
  db.assets = { frames: {}, backgrounds: {}, ...(raw.assets || {}) };
} catch (e) {
  if (e.code !== 'ENOENT') console.error('Konnte db.json nicht lesen, starte leer:', e.message);
}

let saveTimer = null;
let saving = Promise.resolve();
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = JSON.stringify(db, null, 2);
    saving = saving.then(async () => {
      const tmp = DB_FILE + '.tmp';
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, DB_FILE);
    }).catch((e) => console.error('Speichern fehlgeschlagen:', e.message));
  }, 150);
}

const clean = (v, max = 60) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ */
/* Admin-Passwort & Sitzungen                                          */
/* ------------------------------------------------------------------ */
let adminPassword = process.env.ADMIN_PASSWORD || '';
let passwordGenerated = false;
const pwFile = path.join(DATA, 'admin-password.txt');
if (!adminPassword) {
  try { adminPassword = fs.readFileSync(pwFile, 'utf8').trim(); } catch { /* wird erzeugt */ }
  if (!adminPassword) {
    adminPassword = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(pwFile, adminPassword + '\n', { mode: 0o600 });
    passwordGenerated = true;
  }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sessions = new Map(); // token -> Ablaufzeit
const SESSION_MS = 12 * 60 * 60 * 1000;

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function isAdmin(req) {
  const token = cookies(req).woc_admin;
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
  next();
}

// Einfaches Rate-Limit im Speicher
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  return ++b.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}, 60_000).unref();

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */
function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return 'localhost';
}
function requestHostname(req) {
  const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$/i.exec(req.headers.host || '');
  const h = m && m[1].toLowerCase();
  if (!h || h === 'localhost' || h.startsWith('127.') || h === '[::1]') return lanIp();
  return h;
}
/** Basis-URL, unter der Gäste (QR-Code) den Server erreichen. */
function publicBase(req) {
  return db.settings.publicUrl || `http://${requestHostname(req)}:${PORT}`;
}

function limiter(max) {
  let n = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      if (n > max) return cb(Object.assign(new Error('Datei zu groß'), { status: 413 }));
      cb(null, chunk);
    },
  });
}
async function saveStream(req, dest, max) {
  try {
    await pipeline(req, limiter(max), fs.createWriteStream(dest, { flags: 'wx' }));
  } catch (e) {
    await fsp.rm(dest, { force: true });
    throw e;
  }
}
const contentType = (req) => (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

const prettyName = (file) => {
  const n = path.basename(file, path.extname(file)).replace(/^\d+[-_ ]+/, '').replace(/[-_]+/g, ' ').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
};

async function listAssets(kind) {
  const dir = ASSET_DIRS[kind];
  let files = [];
  try { files = await fsp.readdir(dir); } catch { /* leer */ }
  const meta = db.assets[kind];
  return files
    .filter((f) => !f.startsWith('.') && ASSET_EXT[kind].includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    .map((file) => ({
      file,
      url: `/assets/${kind}/${encodeURIComponent(file)}`,
      name: meta[file]?.name || prettyName(file),
      enabled: meta[file]?.enabled !== false,
    }));
}

const itemUrl = (file) => (file ? `/media/${file}` : null);
const publicItem = (i) => ({
  id: i.id, kind: i.kind, url: i.asset ? `/assets/media/${encodeURIComponent(i.asset)}` : itemUrl(i.file), thumb: itemUrl(i.thumb), title: i.title || '', createdAt: i.createdAt, ratio: i.ratio || null,
});
const adminItem = (i) => ({ ...publicItem(i), onWall: !!i.onWall, shared: i.shared, reviewed: i.reviewed, station: i.station, frame: i.frame });

async function deleteItem(item) {
  db.items = db.items.filter((i) => i !== item);
  for (const f of [item.file, item.thumb]) if (f) await fsp.rm(path.join(UPLOADS, f), { force: true });
  if (item.asset) await fsp.rm(path.join(MEDIA_DIR, item.asset), { force: true });
  save();
}

/** Gleicht den Ordner assets/media mit der Wall ab: neue Dateien erscheinen, gelöschte verschwinden. */
const MEDIA_EXT = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([type, ext]) => [ext, type.split('/')[0]]));
MEDIA_EXT['.jpeg'] = 'image';
async function syncMediaFolder() {
  let files = [];
  try { files = await fsp.readdir(MEDIA_DIR); } catch { return; }
  files = files.filter((f) => !f.startsWith('.') && MEDIA_EXT[path.extname(f).toLowerCase()]);
  const known = new Set(db.items.filter((i) => i.asset).map((i) => i.asset));
  let changed = false;
  for (const f of files) {
    if (known.has(f)) continue;
    db.items.push({
      id: newId(), kind: MEDIA_EXT[path.extname(f).toLowerCase()], asset: f, file: null, thumb: null,
      title: '', createdAt: Date.now(), onWall: true,
    });
    changed = true;
  }
  const gone = db.items.filter((i) => i.asset && !files.includes(i.asset));
  for (const item of gone) {
    db.items = db.items.filter((i) => i !== item);
    if (item.thumb) await fsp.rm(path.join(UPLOADS, item.thumb), { force: true });
    changed = true;
  }
  if (changed) { save(); broadcast('items'); }
}

/* ------------------------------------------------------------------ */
/* Live-Verbindungen (Server-Sent Events)                              */
/* ------------------------------------------------------------------ */
const clients = new Set();
function send(client, type, data = {}) {
  client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(type, data = {}, roles) {
  for (const c of clients) if (!roles || roles.includes(c.role)) send(c, type, data);
}
const deviceList = () => [...clients]
  .filter((c) => c.role !== 'admin')
  .map((c) => ({ id: c.id, role: c.role, name: c.name, ip: c.ip, since: c.since }));
const devicesChanged = () => broadcast('devices', { devices: deviceList() }, ['admin']);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000).unref();

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  });
  if (req.path.startsWith('/api/') || req.path.startsWith('/p/')) res.set('Cache-Control', 'no-store');
  next();
});

// Hochgeladene Dateien nie als aktives Dokument ausführen lassen
const passive = (res) => res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
app.use('/media', express.static(UPLOADS, { index: false, dotfiles: 'deny', maxAge: '7d', immutable: true, setHeaders: passive }));
app.use('/assets', express.static(ASSETS, { index: false, dotfiles: 'deny', maxAge: '5m', setHeaders: passive }));
app.use(express.static(path.join(ROOT, 'public'), { index: false, dotfiles: 'deny', maxAge: 0 }));

const page = (name) => (_req, res) => res.sendFile(path.join(ROOT, 'public', name));
app.get('/', page('wall.html'));
app.get('/wall', page('wall.html'));
app.get('/station', page('station.html'));
app.get('/admin', page('admin.html'));
app.get('/hunt', page('hunt.html'));

/* ---------- Öffentliche API ---------- */
app.get('/api/state', async (_req, res) => {
  const [frames, backgrounds] = await Promise.all([listAssets('frames'), listAssets('backgrounds')]);
  const bg = backgrounds.find((b) => b.file === db.settings.background);
  const { publicUrl, ...settings } = db.settings;
  res.json({
    settings,
    logoUrl: logoUrl(),
    hunt: { active: db.hunt.active, winner: db.hunt.showWinner ? winnerInfo() : null },
    backgroundUrl: bg ? bg.url : null,
    frames: frames.filter((f) => f.enabled).map(({ file, url, name }) => ({ file, url, name })),
  });
});

function logoUrl() {
  for (const ext of ['.svg', '.png', '.webp']) if (fs.existsSync(path.join(ASSETS, 'logo' + ext))) return '/assets/logo' + ext;
  return null;
}

app.get('/api/wall', (_req, res) => {
  res.json({ items: db.items.filter((i) => i.onWall).map(publicItem) });
});

app.get('/api/events', (req, res) => {
  const role = ['wall', 'station', 'admin'].includes(req.query.role) ? req.query.role : 'wall';
  if (role === 'admin' && !isAdmin(req)) return res.status(401).end();
  if (clients.size >= 300) return res.status(503).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = {
    res, role, id: newId(), since: Date.now(), ip: req.socket.remoteAddress,
    name: clean(req.query.name, 40) || (role === 'wall' ? 'Wall' : 'Station'),
  };
  clients.add(client);
  send(client, 'hello', {});
  if (role !== 'admin') devicesChanged();
  req.on('close', () => { clients.delete(client); if (role !== 'admin') devicesChanged(); });
});

// Foto von einer Fotostation
app.post('/api/photos', express.raw({ type: 'image/jpeg', limit: MAX_PHOTO }), async (req, res) => {
  if (!db.settings.stationsEnabled) return res.status(403).json({ error: 'Fotostationen sind pausiert' });
  if (!rateLimit('photo:' + req.socket.remoteAddress, 30, 60_000)) return res.status(429).json({ error: 'Zu viele Fotos, bitte kurz warten' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return res.status(400).json({ error: 'Es wird ein JPEG-Bild erwartet' });
  }
  const id = newId();
  const file = `photo-${id}.jpg`;
  await fsp.writeFile(path.join(UPLOADS, file), buf, { flag: 'wx' });
  const shared = req.query.share === '1';
  const item = {
    id, kind: 'photo', file, thumb: null, title: '', createdAt: Date.now(),
    shared, reviewed: !db.settings.moderation, onWall: shared && !db.settings.moderation,
    station: clean(req.query.station, 40), frame: clean(req.query.frame, 80),
  };
  const w = Number(req.query.w), h = Number(req.query.h);
  if (w > 0 && h > 0) item.ratio = Math.min(4, Math.max(0.25, Math.round(w / h * 1000) / 1000));
  db.items.push(item);
  save();
  broadcast('items', { added: item.onWall ? id : null });
  res.status(201).json({
    id, url: itemUrl(file), page: `${publicBase(req)}/p/${id}`, qr: `/api/photos/${id}/qr.svg`,
    onWall: item.onWall, pending: shared && !item.onWall,
  });
});

const findPhoto = (id) => db.items.find((i) => i.id === id && i.kind === 'photo');

app.get('/api/photos/:id/qr.svg', async (req, res) => {
  if (!findPhoto(req.params.id)) return res.status(404).end();
  const svg = await QRCode.toString(`${publicBase(req)}/p/${req.params.id}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

app.get('/p/:id/download', (req, res) => {
  const item = findPhoto(req.params.id);
  if (!item) return res.status(404).send('Foto nicht gefunden');
  const d = new Date(item.createdAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  res.download(path.join(UPLOADS, item.file), `foto-${stamp}-${item.id.slice(0, 5)}.jpg`);
});

app.get('/p/:id', (req, res) => {
  const item = findPhoto(req.params.id);
  const title = escapeHtml(db.settings.title);
  const body = item
    ? `<img class="dl-photo" src="${itemUrl(item.file)}" alt="Dein Foto">
       <a class="btn primary big" href="/p/${item.id}/download" download>Foto herunterladen</a>
       <p class="hint">Tipp: Du kannst das Bild auch lange gedrückt halten und „Speichern“ wählen.</p>`
    : `<h2>Foto nicht gefunden</h2><p class="hint">Das Foto wurde gelöscht oder der Link ist nicht mehr gültig.</p>`;
  res.status(item ? 200 : 404).type('html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Dein Foto – ${title}</title><link rel="stylesheet" href="/css/style.css"></head>
<body class="download" style="--accent:${escapeHtml(db.settings.accent)}"><main class="dl-card"><h1>${title}</h1>${body}${logoUrl() ? `<img class="logo" src="${logoUrl()}" alt="">` : ''}</main></body></html>`);
});

/* ---------- Admin-API ---------- */
app.use('/api/admin', express.json({ limit: '100kb' }));

app.post('/api/admin/login', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
  if (!rateLimit('login:' + req.socket.remoteAddress, 10, 10 * 60_000)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut probieren.' });
  }
  const ok = crypto.timingSafeEqual(sha(req.body?.password ?? ''), sha(adminPassword));
  if (!ok) return res.status(401).json({ error: 'Falsches Passwort' });
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_MS);
  res.set('Set-Cookie', `woc_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(cookies(req).woc_admin);
  res.set('Set-Cookie', 'woc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  if (process.env.ADMIN_PASSWORD) {
    return res.status(409).json({ error: 'Das Passwort ist über die Umgebungsvariable ADMIN_PASSWORD festgelegt und kann hier nicht geändert werden.' });
  }
  if (!rateLimit('pw:' + req.socket.remoteAddress, 10, 10 * 60_000)) return res.status(429).json({ error: 'Zu viele Versuche' });
  const { current, next } = req.body || {};
  if (!crypto.timingSafeEqual(sha(current ?? ''), sha(adminPassword))) return res.status(403).json({ error: 'Aktuelles Passwort ist falsch' });
  if (typeof next !== 'string' || next.length < 6 || next.length > 100) {
    return res.status(400).json({ error: 'Das neue Passwort muss 6 bis 100 Zeichen lang sein' });
  }
  if (/[\r\n]/.test(next)) return res.status(400).json({ error: 'Ungültige Zeichen im Passwort' });
  await fsp.writeFile(pwFile, next + '\n', { mode: 0o600 });
  adminPassword = next;
  const keep = cookies(req).woc_admin;
  for (const t of sessions.keys()) if (t !== keep) sessions.delete(t); // andere Geräte abmelden
  res.json({ ok: true });
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  await syncMediaFolder();
  const [frames, backgrounds] = await Promise.all([listAssets('frames'), listAssets('backgrounds')]);
  const host = requestHostname(req);
  res.json({
    settings: db.settings,
    items: db.items.map(adminItem).sort((a, b) => b.createdAt - a.createdAt),
    frames, backgrounds,
    devices: deviceList(),
    hunt: adminHunt(),
    urls: {
      hunt: `${publicBase(req)}/hunt`,
      wall: `http://${host}:${PORT}/`,
      station: HTTPS_PORT ? `https://${host}:${HTTPS_PORT}/station` : `http://${host}:${PORT}/station`,
      download: publicBase(req),
    },
  });
});

app.get('/api/admin/qr.svg', requireAdmin, async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).end();
  res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 2 }));
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    const val = validateSetting(k, v);
    if (val === undefined) return res.status(400).json({ error: `Ungültiger Wert für „${k}“` });
    patch[k] = val;
  }
  if (patch.background) {
    const list = await listAssets('backgrounds');
    if (!list.some((b) => b.file === patch.background)) return res.status(400).json({ error: 'Hintergrund nicht gefunden' });
  }
  Object.assign(db.settings, patch);
  save();
  broadcast('settings');
  res.json({ settings: db.settings });
});

// Bild/Video für die Wall hochladen (Rohdaten im Body)
app.post('/api/admin/media', requireAdmin, async (req, res) => {
  const ext = MEDIA_TYPES[contentType(req)];
  if (!ext) return res.status(415).json({ error: 'Dateityp nicht unterstützt (JPG, PNG, WebP, GIF, MP4, WebM, MOV)' });
  const id = newId();
  const file = `media-${id}${ext}`;
  await saveStream(req, path.join(UPLOADS, file), MAX_MEDIA);
  const item = {
    id, kind: contentType(req).startsWith('video/') ? 'video' : 'image', file, thumb: null,
    title: clean(String(req.query.name || '').replace(/\.[a-z0-9]+$/i, ''), 80), createdAt: Date.now(), onWall: true,
  };
  db.items.push(item);
  save();
  broadcast('items', { added: id });
  res.status(201).json({ item: adminItem(item) });
});

app.put('/api/admin/items/:id/thumb', requireAdmin, express.raw({ type: 'image/jpeg', limit: '3mb' }), async (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: 'JPEG erwartet' });
  const thumb = `thumb-${item.id}.jpg`;
  await fsp.writeFile(path.join(UPLOADS, thumb), buf);
  item.thumb = thumb;
  save();
  broadcast('items');
  res.json({ item: adminItem(item) });
});

app.patch('/api/admin/items/:id', requireAdmin, (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  const { onWall, title } = req.body || {};
  if (typeof title === 'string') item.title = clean(title, 80);
  if (typeof onWall === 'boolean') {
    if (onWall && item.kind === 'photo' && !item.shared) {
      return res.status(409).json({ error: 'Der Gast hat der Anzeige auf der Wall nicht zugestimmt' });
    }
    item.onWall = onWall;
    if (item.kind === 'photo') item.reviewed = true;
  }
  save();
  broadcast('items', { added: onWall === true ? item.id : null });
  res.json({ item: adminItem(item) });
});

app.delete('/api/admin/items/:id', requireAdmin, async (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  await deleteItem(item);
  broadcast('items');
  res.json({ ok: true });
});

// Rahmen & Hintergründe
function assetKind(req, res, next) {
  if (!Object.hasOwn(ASSET_DIRS, req.params.kind)) return res.status(404).json({ error: 'Unbekannt' });
  next();
}
async function findAsset(req, res) {
  const list = await listAssets(req.params.kind);
  const asset = list.find((a) => a.file === req.params.file);
  if (!asset) res.status(404).json({ error: 'Nicht gefunden' });
  return asset;
}

app.post('/api/admin/assets/:kind', requireAdmin, assetKind, async (req, res) => {
  const { kind } = req.params;
  const ext = ASSET_TYPES[kind][contentType(req)];
  if (!ext) {
    return res.status(415).json({ error: kind === 'frames' ? 'Rahmen müssen JPG, PNG, WebP oder SVG sein' : 'Bitte JPG, PNG, WebP oder SVG hochladen' });
  }
  const base = clean(String(req.query.name || ''), 80).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-').replace(/^-+|-+$/g, '') || kind.slice(0, -1);
  let file = base + ext;
  for (let n = 2; fs.existsSync(path.join(ASSET_DIRS[kind], file)); n++) file = `${base}-${n}${ext}`;
  await saveStream(req, path.join(ASSET_DIRS[kind], file), MAX_ASSET);
  broadcast('settings');
  res.status(201).json({ file });
});

app.patch('/api/admin/assets/:kind/:file', requireAdmin, assetKind, async (req, res) => {
  const asset = await findAsset(req, res);
  if (!asset) return;
  const meta = (db.assets[req.params.kind][asset.file] ||= {});
  if (typeof req.body?.enabled === 'boolean') meta.enabled = req.body.enabled;
  if (typeof req.body?.name === 'string') meta.name = clean(req.body.name, 60);
  save();
  broadcast('settings');
  res.json({ ok: true });
});

app.delete('/api/admin/assets/:kind/:file', requireAdmin, assetKind, async (req, res) => {
  const asset = await findAsset(req, res);
  if (!asset) return;
  const { kind } = req.params;
  await fsp.rm(path.join(ASSET_DIRS[kind], asset.file), { force: true });
  delete db.assets[kind][asset.file];
  if (kind === 'backgrounds' && db.settings.background === asset.file) db.settings.background = '';
  save();
  broadcast('settings');
  res.json({ ok: true });
});

// Fernsteuerung: Wall/Stationen neu laden, Inhalt auf der Wall öffnen/schließen
app.post('/api/admin/command', requireAdmin, (req, res) => {
  const { action, target, id } = req.body || {};
  if (action === 'reload') {
    broadcast('command', { action }, target === 'wall' ? ['wall'] : target === 'station' ? ['station'] : ['wall', 'station']);
  } else if (action === 'show' && db.items.some((i) => i.id === id && i.onWall)) {
    broadcast('command', { action, id }, ['wall']);
  } else if (action === 'close') {
    broadcast('command', { action }, ['wall']);
  } else {
    return res.status(400).json({ error: 'Unbekannter Befehl' });
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Color Hunt                                                          */
/* ------------------------------------------------------------------ */
const HUNT_COLORS = [
  { name: 'Rot', hex: '#e53935' }, { name: 'Orange', hex: '#fb8c00' }, { name: 'Gelb', hex: '#fdd835' },
  { name: 'Grün', hex: '#43a047' }, { name: 'Blau', hex: '#1e88e5' }, { name: 'Lila', hex: '#8e24aa' },
  { name: 'Pink', hex: '#ec407a' }, { name: 'Türkis', hex: '#00acc1' }, { name: 'Braun', hex: '#795548' },
  { name: 'Weiß', hex: '#ffffff' }, { name: 'Schwarz', hex: '#212121' }, { name: 'Grau', hex: '#9e9e9e' },
];
const HUNT_GRACE_MS = 20_000; // Puffer für Uploads, die kurz vor Ablauf gestartet wurden

const huntPhotoUrls = (p) => p.photos.map((f) => itemUrl(f));
function huntStatus(p, now = Date.now()) {
  if (p.finishedAt) return 'done';
  if (!p.startedAt) return 'ready';
  return now > p.deadline ? 'done' : 'running';
}
function winnerInfo() {
  const p = db.hunt.players.find((x) => x.id === db.hunt.winnerId);
  return p ? { id: p.id, name: p.name, color: p.color, photos: huntPhotoUrls(p).filter(Boolean) } : null;
}
function adminHunt() {
  const now = Date.now();
  return {
    active: db.hunt.active, winnerId: db.hunt.winnerId, showWinner: db.hunt.showWinner, now,
    players: db.hunt.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, joinedAt: p.joinedAt, startedAt: p.startedAt, deadline: p.deadline,
      finishedAt: p.finishedAt, status: huntStatus(p, now), photos: huntPhotoUrls(p),
    })).sort((a, b) => b.joinedAt - a.joinedAt),
  };
}
function huntPlayer(req) {
  const token = cookies(req).woc_hunt;
  if (!token) return null;
  const hash = sha(token).toString('hex');
  return db.hunt.players.find((p) => p.tokenHash === hash) || null;
}
function playerView(p) {
  return {
    id: p.id, name: p.name, color: p.color, photoCount: p.photoCount, duration: p.duration,
    startedAt: p.startedAt, deadline: p.deadline, status: huntStatus(p), photos: huntPhotoUrls(p),
  };
}
const huntChanged = () => { save(); broadcast('hunt', {}, ['wall', 'admin']); };
async function removeHuntPlayer(p) {
  db.hunt.players = db.hunt.players.filter((x) => x !== p);
  for (const f of p.photos) if (f) await fsp.rm(path.join(UPLOADS, f), { force: true });
  if (db.hunt.winnerId === p.id) { db.hunt.winnerId = null; db.hunt.showWinner = false; }
}

app.use('/api/hunt', express.json({ limit: '10kb' }));

app.get('/api/hunt/me', (req, res) => {
  const p = huntPlayer(req);
  res.json({
    active: db.hunt.active, now: Date.now(), title: db.settings.title,
    photoCount: db.settings.huntPhotos, minutes: db.settings.huntMinutes,
    player: p ? playerView(p) : null,
  });
});

app.post('/api/hunt/join', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
  if (huntPlayer(req)) return res.status(409).json({ error: 'Du machst schon mit – jeder kann nur einmal teilnehmen.' });
  if (!db.hunt.active) return res.status(403).json({ error: 'Der Color Hunt ist gerade nicht geöffnet.' });
  if (!rateLimit('hunt:' + req.socket.remoteAddress, 20, 10 * 60_000)) return res.status(429).json({ error: 'Zu viele Versuche, bitte kurz warten' });
  const name = clean(req.body?.name, 30).replace(/\s+/g, ' ');
  if (name.length < 2) return res.status(400).json({ error: 'Bitte gib deinen Namen ein (mindestens 2 Zeichen).' });
  if (db.hunt.players.some((p) => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
    return res.status(409).json({ error: 'Dieser Name ist schon vergeben – jeder kann nur einmal mitmachen.' });
  }
  if (db.hunt.players.length >= 500) return res.status(503).json({ error: 'Maximale Teilnehmerzahl erreicht' });
  // am wenigsten vergebene Farbe, bei Gleichstand zufällig
  const used = new Map(HUNT_COLORS.map((c) => [c.name, 0]));
  for (const p of db.hunt.players) used.set(p.color.name, (used.get(p.color.name) || 0) + 1);
  const min = Math.min(...used.values());
  const pool = HUNT_COLORS.filter((c) => used.get(c.name) === min);
  const color = pool[crypto.randomInt(pool.length)];
  const token = crypto.randomBytes(24).toString('base64url');
  const p = {
    id: newId(), tokenHash: sha(token).toString('hex'), name, color, joinedAt: Date.now(),
    photoCount: db.settings.huntPhotos, duration: db.settings.huntMinutes * 60_000,
    startedAt: null, deadline: null, finishedAt: null, photos: Array(db.settings.huntPhotos).fill(null),
  };
  db.hunt.players.push(p);
  huntChanged();
  res.set('Set-Cookie', `woc_hunt=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${2 * 86400}${req.secure ? '; Secure' : ''}`);
  res.status(201).json({ player: playerView(p), now: Date.now() });
});

app.post('/api/hunt/start', (req, res) => {
  const p = huntPlayer(req);
  if (!p) return res.status(401).json({ error: 'Bitte zuerst anmelden' });
  if (!p.startedAt) {
    p.startedAt = Date.now();
    p.deadline = p.startedAt + p.duration;
    huntChanged();
  }
  res.json({ player: playerView(p), now: Date.now() });
});

app.put('/api/hunt/photos/:slot', express.raw({ type: 'image/jpeg', limit: MAX_PHOTO }), async (req, res) => {
  const p = huntPlayer(req);
  if (!p) return res.status(401).json({ error: 'Bitte zuerst anmelden' });
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= p.photoCount) return res.status(400).json({ error: 'Ungültiges Foto-Feld' });
  if (!p.startedAt) return res.status(409).json({ error: 'Die Zeit wurde noch nicht gestartet' });
  if (p.finishedAt || Date.now() > p.deadline + HUNT_GRACE_MS) return res.status(409).json({ error: 'Die Zeit ist abgelaufen' });
  if (!rateLimit('huntphoto:' + p.id, 40, 60_000)) return res.status(429).json({ error: 'Zu viele Uploads' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return res.status(400).json({ error: 'Es wird ein JPEG-Bild erwartet' });
  }
  const file = `hunt-${p.id}-${slot}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  await fsp.writeFile(path.join(UPLOADS, file), buf, { flag: 'wx' });
  if (!huntPlayer(req)) { // Spieler wurde inzwischen gelöscht
    await fsp.rm(path.join(UPLOADS, file), { force: true });
    return res.status(410).json({ error: 'Teilnahme wurde beendet' });
  }
  const old = p.photos[slot];
  p.photos[slot] = file;
  if (old) await fsp.rm(path.join(UPLOADS, old), { force: true });
  huntChanged();
  res.json({ player: playerView(p), now: Date.now() });
});

app.post('/api/hunt/finish', (req, res) => {
  const p = huntPlayer(req);
  if (!p) return res.status(401).json({ error: 'Bitte zuerst anmelden' });
  if (!p.startedAt) return res.status(409).json({ error: 'Die Zeit wurde noch nicht gestartet' });
  if (!p.finishedAt) {
    p.finishedAt = Math.min(Date.now(), p.deadline);
    huntChanged();
  }
  res.json({ player: playerView(p), now: Date.now() });
});

app.get('/api/hunt/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(`${publicBase(req)}/hunt`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

app.put('/api/admin/hunt', requireAdmin, (req, res) => {
  const { active, winnerId, showWinner } = req.body || {};
  if (typeof active === 'boolean') db.hunt.active = active;
  if (winnerId === null) { db.hunt.winnerId = null; db.hunt.showWinner = false; }
  if (typeof winnerId === 'string') {
    if (!db.hunt.players.some((p) => p.id === winnerId)) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
    db.hunt.winnerId = winnerId;
    db.hunt.showWinner = true;
  }
  if (typeof showWinner === 'boolean') db.hunt.showWinner = showWinner && !!db.hunt.winnerId;
  huntChanged();
  res.json({ hunt: adminHunt() });
});

app.delete('/api/admin/hunt/players/:id', requireAdmin, async (req, res) => {
  const p = db.hunt.players.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden' });
  await removeHuntPlayer(p);
  huntChanged();
  res.json({ ok: true });
});

// Neue Runde: alle Teilnehmer und ihre Fotos löschen
app.post('/api/admin/hunt/reset', requireAdmin, async (_req, res) => {
  for (const p of [...db.hunt.players]) await removeHuntPlayer(p);
  db.hunt = { ...emptyHunt(), active: db.hunt.active };
  huntChanged();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
app.use((_req, res) => res.status(404).type('text').send('Nicht gefunden'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.destroy();
  const msg = status === 413 ? 'Datei zu groß' : status >= 500 ? 'Serverfehler' : err.message || 'Fehler';
  res.status(status).json({ error: msg });
});

/* ------------------------------------------------------------------ */
/* Automatisches Löschen alter Fotos                                   */
/* ------------------------------------------------------------------ */
async function cleanup() {
  const hours = db.settings.retentionHours;
  if (!hours) return;
  const limit = Date.now() - hours * 3600_000;
  const old = db.items.filter((i) => i.kind === 'photo' && i.createdAt < limit);
  for (const item of old) await deleteItem(item);
  if (old.length) broadcast('items');
}
setInterval(() => cleanup().catch((e) => console.error(e)), 10 * 60_000).unref();

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
async function certificate() {
  const keyFile = path.join(DATA, 'https-key.pem');
  const certFile = path.join(DATA, 'https-cert.pem');
  const ip = lanIp();
  try {
    const cert = fs.readFileSync(certFile, 'utf8');
    const x = new crypto.X509Certificate(cert);
    const valid = new Date(x.validTo).getTime() - Date.now() > 7 * 86400_000;
    if (valid && (ip === 'localhost' || (x.subjectAltName || '').includes(ip))) {
      return { key: fs.readFileSync(keyFile, 'utf8'), cert };
    }
  } catch { /* neu erzeugen */ }
  const selfsigned = require('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, { type: 2, value: os.hostname() }, { type: 7, ip: '127.0.0.1' }];
  if (ip !== 'localhost') altNames.push({ type: 7, ip });
  const notAfterDate = new Date(Date.now() + 365 * 86400_000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Wall of Content' }], {
    keySize: 2048, algorithm: 'sha256', notAfterDate,
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

async function main() {
  await cleanup();
  await syncMediaFolder();
  let watchTimer = null;
  try {
    fs.watch(MEDIA_DIR, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => syncMediaFolder().catch((e) => console.error(e)), 1500);
    });
  } catch { /* Ordnerüberwachung nicht verfügbar – Abgleich erfolgt beim Öffnen des Admin-Panels */ }
  const ip = lanIp();
  await new Promise((resolve) => http.createServer(app).listen(PORT, resolve));
  let httpsOk = false;
  if (HTTPS_PORT) {
    try {
      const tls = await certificate();
      await new Promise((resolve, reject) => https.createServer(tls, app).on('error', reject).listen(HTTPS_PORT, resolve));
      httpsOk = true;
    } catch (e) {
      console.error('HTTPS konnte nicht gestartet werden:', e.message);
    }
  }
  const stationUrl = httpsOk ? `https://${ip}:${HTTPS_PORT}/station` : `http://${ip}:${PORT}/station`;
  console.log(`
  Wall of Content läuft

  Wall (Bildschirm):   http://localhost:${PORT}/        (im Netzwerk: http://${ip}:${PORT}/)
  Fotostation (Handy): ${stationUrl}
  Admin-Panel:         http://localhost:${PORT}/admin   (im Netzwerk: http://${ip}:${PORT}/admin)
  Color Hunt (Gäste):  ${db.settings.publicUrl || `http://${ip}:${PORT}`}/hunt

  Admin-Passwort:      ${process.env.ADMIN_PASSWORD ? '(aus ADMIN_PASSWORD)' : adminPassword + (passwordGenerated ? `   (neu erzeugt, gespeichert in ${path.relative(ROOT, pwFile)})` : `   (aus ${path.relative(ROOT, pwFile)})`)}
${httpsOk ? '\n  Hinweis: Die Kamera im Handy-Browser funktioniert nur über HTTPS. Beim ersten Öffnen der\n  Fotostation die Zertifikatswarnung einmalig bestätigen ("Erweitert" -> "Trotzdem fortfahren").\n' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
