'use strict';
/**
 * Wall of Content – Server
 *  /         Wall (Bildschirm mit schwebenden Thumbnails)
 *  /station  Fotostation (Handy)
 *  /admin    Admin-Panel
 *  /p/:id    Download-Seite eines Fotos (Ziel des QR-Codes)
 *  /hunt     Color Hunt (Gäste-Handy)
 *  /quiz     Quiz (iPad); zeigt die Wall, solange kein Quiz läuft
 *  /app      Besucher-App: Live-Programm, Challenges, Merch-Shop, Feedback (lib/portal.js)
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
const AVATARS = path.join(ASSETS, 'avatars');

const MEDIA_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};
const ASSET_TYPES = {
  frames: { 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg' },
  backgrounds: { 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'video/mp4': '.mp4', 'video/webm': '.webm' },
};
const ASSET_EXT = {
  frames: ['.png', '.webp', '.svg', '.jpg', '.jpeg'],
  backgrounds: ['.png', '.webp', '.svg', '.jpg', '.jpeg', '.mp4', '.webm'],
};

for (const d of [DATA, UPLOADS, MEDIA_DIR, AVATARS, ...Object.values(ASSET_DIRS)]) fs.mkdirSync(d, { recursive: true });

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
  quizCount: { type: 'int', min: 3, max: 20, def: 8 },
  quizSeconds: { type: 'int', min: 5, max: 60, def: 20 },
  // Verbund-Wall (experimentell): mehrere Bildschirme bilden eine große Wall
  gridCols: { type: 'int', min: 1, max: 8, def: 3 },
  gridRows: { type: 'int', min: 1, max: 4, def: 1 },
  gridAspect: { type: 'enum', values: ['4:3', '16:10', '16:9', '3:4', '9:16'], def: '4:3' },
  // Besucher-App: Punkte für den digitalen Rundgang, QR-Code zur App auf der Wall
  stationPoints: { type: 'int', min: 0, max: 10000, def: 10 },
  tourBonus: { type: 'int', min: 0, max: 100000, def: 50 },
  portalQr: { type: 'bool', def: false },
  huntMinutes: { type: 'int', min: 1, max: 30, def: 5 },
  huntPhotos: { type: 'int', min: 1, max: 10, def: 5 },
  qrTimeout: { type: 'int', min: 10, max: 600, def: 60 },
  retentionHours: { type: 'int', min: 0, max: 8760, def: 0 },
  publicUrl: { type: 'url', def: '' },
  // Show-Modus: Vorladen, QR-Größe, Vollbild, Teilen-QR im Viewer
  preloadMedia: { type: 'bool', def: true },
  qrSize: { type: 'int', min: 50, max: 200, def: 100 },
  autoFullscreen: { type: 'bool', def: false },
  viewerQr: { type: 'bool', def: true },
  // DVD-Logo-Bildschirmschoner auf der Wall
  dvdMode: { type: 'bool', def: false },
  dvdCorners: { type: 'bool', def: false },
  dvdIdle: { type: 'num', min: 0.5, max: 120, def: 5 },
  dvdSpeed: { type: 'num', min: 0.2, max: 5, def: 1 },
};
const newId = () => crypto.randomBytes(9).toString('base64url');
let settingsVersion = Date.now(); // ändert sich bei jeder Einstellungsänderung (Wall holt dann z. B. QR-Codes neu)
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.def]));

function validateSetting(key, value) {
  const s = SETTINGS[key];
  if (!s) return undefined;
  switch (s.type) {
    case 'string': return typeof value === 'string' ? value.trim().slice(0, s.max) : undefined;
    case 'bool': return typeof value === 'boolean' ? value : undefined;
    case 'enum': return s.values.includes(value) ? value : undefined;
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

const emptyHunt = () => ({ active: false, endsAt: null, round: newId(), players: [], winnerId: null, showWinner: false });
const DEFAULT_QUESTIONS = [
  ['Welche Farbe entsteht, wenn du Blau und Gelb mischst?', ['Grün', 'Lila', 'Orange', 'Braun'], 0],
  ['Welche Farbe entsteht, wenn du Rot und Gelb mischst?', ['Grün', 'Orange', 'Pink', 'Blau'], 1],
  ['Wie viele Farben hat ein Regenbogen?', ['3', '5', '7', '10'], 2],
  ['Womit sprüht man ein Graffiti?', ['Mit einem Pinsel', 'Mit einer Sprühdose', 'Mit Kreide', 'Mit einem Bleistift'], 1],
  ['Welches Tier kann seine Farbe wechseln?', ['Chamäleon', 'Elefant', 'Pinguin', 'Igel'], 0],
  ['Wie viele Beine hat eine Spinne?', ['4', '6', '8', '10'], 2],
  ['Welcher Planet ist der Sonne am nächsten?', ['Erde', 'Mars', 'Merkur', 'Jupiter'], 2],
  ['Was ist das größte Tier der Welt?', ['Elefant', 'Blauwal', 'Giraffe', 'Hai'], 1],
  ['Wie viele Minuten hat eine Stunde?', ['30', '60', '90', '100'], 1],
  ['Welche Form hat ein Stoppschild?', ['Dreieck', 'Kreis', 'Achteck', 'Quadrat'], 2],
  ['Welche Farbe hat ein Smaragd?', ['Rot', 'Blau', 'Gelb', 'Grün'], 3],
  ['Was brauchen Pflanzen zum Wachsen?', ['Licht und Wasser', 'Schokolade', 'Musik', 'Sand'], 0],
  ['Wie heißt ein Bild, das direkt auf eine Hauswand gemalt wird?', ['Wandbild (Mural)', 'Postkarte', 'Poster', 'Fotoalbum'], 0],
  ['Was ist gefrorenes Wasser?', ['Dampf', 'Eis', 'Nebel', 'Regen'], 1],
];
const emptyQuiz = () => ({
  active: false, showBoard: false, scores: [],
  questions: DEFAULT_QUESTIONS.map(([text, answers, correct]) => ({ id: newId(), text, answers, correct })),
});
let db = { settings: defaults(), items: [], assets: { frames: {}, backgrounds: {} }, hunt: emptyHunt(), quiz: emptyQuiz(), users: [], portal: {} };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const known = Object.fromEntries(Object.entries(raw.settings || {}).filter(([k]) => Object.hasOwn(SETTINGS, k)));
  db.settings = { ...defaults(), ...known };
  db.hunt = { ...emptyHunt(), ...(raw.hunt || {}) };
  db.quiz = { ...emptyQuiz(), ...(raw.quiz || {}) };
  db.users = Array.isArray(raw.users) ? raw.users : [];
  db.portal = raw.portal && typeof raw.portal === 'object' ? raw.portal : {};
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
const pwFile = path.join(DATA, 'admin-password.txt');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}
function checkPassword(user, password) {
  // immer rechnen, damit die Antwortzeit nichts über vorhandene Passwörter verrät
  const pass = (user && user.pass) || { salt: 'x', hash: '00'.repeat(32) };
  const got = crypto.scryptSync(String(password ?? ''), pass.salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(pass.hash, 'hex')) && !!(user && user.pass);
}

// Benutzer des Admin-Panels. Der Global Admin verwaltet die anderen und vergibt ihre Passwörter.
if (!db.users.length) {
  db.users = [
    { id: 'david-r', name: 'David R.', role: 'global', avatar: 'david-r.svg', pass: null },
    { id: 'david-k', name: 'David K.', role: 'admin', avatar: 'david-k.jpg', pass: null },
    { id: 'emily-b', name: 'Emily B.', role: 'admin', avatar: 'emily-b.jpg', pass: null },
    { id: 'jakob-k', name: 'Jakob K.', role: 'admin', avatar: 'jakob-k.jpg', pass: null },
    { id: 'lilian-h', name: 'Lilian H.', role: 'admin', avatar: 'lilian-h.jpg', pass: null },
  ];
}
const globalAdmin = () => db.users.find((u) => u.role === 'global') || db.users[0];
let startPassword = null; // nur gesetzt, solange das Startpasswort des Global Admins noch gilt
{
  const g = globalAdmin();
  if (process.env.ADMIN_PASSWORD) {
    g.pass = hashPassword(process.env.ADMIN_PASSWORD); // dient auch als Notfall-Zurücksetzung
  } else {
    try { startPassword = fs.readFileSync(pwFile, 'utf8').trim() || null; } catch { /* keins */ }
    if (!g.pass || (startPassword && !checkPassword(g, startPassword))) {
      if (!g.pass) {
        if (!startPassword) {
          startPassword = crypto.randomBytes(9).toString('base64url');
          fs.writeFileSync(pwFile, startPassword + '\n', { mode: 0o600 });
        }
        g.pass = hashPassword(startPassword);
      } else {
        startPassword = null; // Datei ist veraltet
      }
    }
  }
}
const sessions = new Map(); // token -> { userId, exp }
const SESSION_MS = 12 * 60 * 60 * 1000;

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function currentUser(req) {
  const token = cookies(req).woc_admin;
  const sess = token && sessions.get(token);
  if (!sess) return null;
  if (sess.exp < Date.now()) { sessions.delete(token); return null; }
  return db.users.find((u) => u.id === sess.userId) || null;
}
const isAdmin = (req) => !!currentUser(req);
const publicUser = (u) => ({
  id: u.id, name: u.name, role: u.role, hasPassword: !!u.pass,
  avatar: u.avatar ? `/assets/avatars/${encodeURIComponent(u.avatar)}` : null,
});
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
  req.user = currentUser(req);
  next();
}
function requireGlobal(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.user.role !== 'global') return res.status(403).json({ error: 'Das darf nur der Global Admin' });
    next();
  });
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
  for (const [t, sess] of sessions) if (sess.exp < now) sessions.delete(t);
  for (const [id, q] of quizSessions) if (q.expires < now) quizSessions.delete(id);
}, 60_000).unref();

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */
/**
 * Adresse dieses Rechners im WLAN/LAN. Bevorzugt private Adressen echter Netzwerkkarten
 * (macOS: en0/en1, Windows: WLAN/Ethernet, Linux: wlan/eth) statt VPN, AirDrop, Docker usw.
 * Mit LAN_IP=192.168.1.10 lässt sie sich fest vorgeben.
 */
function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family !== 'IPv4' && i.family !== 4) || i.internal || i.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) score += 2;
      if (/^(en\d|eth|wlan|wlp|enp|eno|wi-?fi|wlan|ethernet)/i.test(name)) score += 1;
      if (/^(docker|br-|veth|vbox|vmnet|virbr|utun|tun|tap|bridge|awdl|llw|zt|tailscale|wg|anpi|ap\d)/i.test(name)) score -= 3;
      candidates.push({ address: i.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].address : 'localhost';
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
  .filter((c) => c.role !== 'admin' && c.role !== 'visitor')
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
app.get('/quiz', page('quiz.html'));

/* ---------- Öffentliche API ---------- */
app.get('/api/state', async (_req, res) => {
  const [frames, backgrounds] = await Promise.all([listAssets('frames'), listAssets('backgrounds')]);
  const bg = backgrounds.find((b) => b.file === db.settings.background);
  const { publicUrl, ...settings } = db.settings;
  res.json({
    settings,
    settingsVersion,
    logoUrl: logoUrl(),
    hunt: { active: db.hunt.active, endsAt: db.hunt.endsAt, now: Date.now(), winner: db.hunt.showWinner ? winnerInfo() : null },
    quiz: { active: db.quiz.active, board: db.quiz.showBoard ? quizBoard(10) : null },
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
  const role = ['wall', 'station', 'admin', 'quiz', 'visitor'].includes(req.query.role) ? req.query.role : 'wall';
  if (role === 'admin' && !isAdmin(req)) return res.status(401).end();
  if (clients.size >= 2000) return res.status(503).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = {
    res, role, id: newId(), since: Date.now(), ip: req.socket.remoteAddress,
    name: clean(req.query.name, 40) || { wall: 'Wall', quiz: 'Quiz-iPad' }[role] || 'Station',
    grid: role === 'wall' && req.query.grid === '1',
  };
  clients.add(client);
  send(client, 'hello', {});
  const isDevice = role !== 'admin' && role !== 'visitor'; // Besucher-Handys nicht in der Geräteliste
  if (isDevice) devicesChanged();
  gridCheck();
  req.on('close', () => { clients.delete(client); if (isDevice) devicesChanged(); gridCheck(); });
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
/** Teilbare Inhalte: Fotos der Stationen immer (Link kennt nur der Gast), Bilder/Videos nur solange sie auf der Wall sind. */
const findShareable = (id) => db.items.find((i) => i.id === id && (i.kind === 'photo' || i.onWall));
const itemFilePath = (item) => (item.asset ? path.join(MEDIA_DIR, item.asset) : path.join(UPLOADS, item.file));

app.get('/api/photos/:id/qr.svg', async (req, res) => {
  if (!findPhoto(req.params.id)) return res.status(404).end();
  const svg = await QRCode.toString(`${publicBase(req)}/p/${req.params.id}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
// QR-Code im Viewer der Wall: Gäste nehmen den gezeigten Inhalt mit aufs Handy
app.get('/api/items/:id/qr.svg', async (req, res) => {
  if (!findShareable(req.params.id)) return res.status(404).end();
  const svg = await QRCode.toString(`${publicBase(req)}/p/${req.params.id}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
  res.type('image/svg+xml').send(svg);
});

app.get('/p/:id/download', (req, res) => {
  const item = findShareable(req.params.id);
  if (!item) return res.status(404).send('Nicht gefunden');
  const d = new Date(item.createdAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = itemFilePath(item);
  const base = item.kind === 'photo' ? 'foto' : clean(item.title, 40).replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-').replace(/^-+|-+$/g, '') || (item.kind === 'video' ? 'video' : 'bild');
  res.download(file, `${base}-${stamp}-${item.id.slice(0, 5)}${path.extname(file).toLowerCase()}`);
});

app.get('/p/:id', (req, res) => {
  const item = findShareable(req.params.id);
  const title = escapeHtml(db.settings.title);
  const url = item && (item.asset ? `/assets/media/${encodeURIComponent(item.asset)}` : itemUrl(item.file));
  const noun = !item || item.kind === 'photo' ? 'Foto' : item.kind === 'video' ? 'Video' : 'Bild';
  const media = !item ? ''
    : item.kind === 'video'
      ? `<video class="dl-photo" src="${url}" controls playsinline preload="metadata"${item.thumb ? ` poster="${itemUrl(item.thumb)}"` : ''}></video>`
      : `<img class="dl-photo" src="${url}" alt="${item.kind === 'photo' ? 'Dein Foto' : escapeHtml(item.title || 'Bild')}">`;
  const body = item
    ? `${item.title ? `<h2>${escapeHtml(item.title)}</h2>` : ''}${media}
       <a class="btn primary big" href="/p/${item.id}/download" download>${noun} herunterladen</a>
       <p class="hint">${item.kind === 'video' ? 'Tipp: Auf dem iPhone das Video öffnen, auf „Teilen“ tippen und „Video sichern“ wählen.' : 'Tipp: Du kannst das Bild auch lange gedrückt halten und „Speichern“ wählen.'}</p>`
    : `<h2>Nicht gefunden</h2><p class="hint">Der Inhalt wurde gelöscht oder der Link ist nicht mehr gültig.</p>`;
  res.status(item ? 200 : 404).type('html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${item && item.kind === 'photo' ? 'Dein Foto' : noun} – ${title}</title><link rel="stylesheet" href="/css/style.css"></head>
<body class="download" style="--accent:${escapeHtml(db.settings.accent)}"><main class="dl-card"><h1>${title}</h1>${body}${logoUrl() ? `<img class="logo" src="${logoUrl()}" alt="">` : ''}</main></body></html>`);
});

/* ---------- Admin-API ---------- */
app.use('/api/admin', express.json({ limit: '100kb' }));

app.get('/api/admin/users', (_req, res) => res.json({ users: db.users.map(publicUser) }));

app.post('/api/admin/login', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
  if (!rateLimit('login:' + req.socket.remoteAddress, 10, 10 * 60_000)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut probieren.' });
  }
  const user = db.users.find((u) => u.id === req.body?.userId);
  const ok = checkPassword(user, req.body?.password);
  if (user && !user.pass) return res.status(401).json({ error: 'Für diesen Benutzer wurde noch kein Passwort vergeben. Der Global Admin kann eines festlegen.' });
  if (!ok) return res.status(401).json({ error: 'Falsches Passwort' });
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId: user.id, exp: Date.now() + SESSION_MS });
  res.set('Set-Cookie', `woc_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true, user: publicUser(user) });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(cookies(req).woc_admin);
  res.set('Set-Cookie', 'woc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => {
  const user = currentUser(req);
  res.json({ admin: !!user, user: user ? publicUser(user) : null });
});

const validPassword = (pw) => typeof pw === 'string' && pw.length >= 6 && pw.length <= 100;
function dropSessions(userId, keepToken) {
  for (const [t, sess] of sessions) if (sess.userId === userId && t !== keepToken) sessions.delete(t);
}
function setPassword(user, password) {
  user.pass = hashPassword(password);
  if (user === globalAdmin() && startPassword) { // Startpasswort gilt nicht mehr
    startPassword = null;
    fs.rmSync(pwFile, { force: true });
  }
  save();
}

// Eigenes Passwort ändern
app.post('/api/admin/password', requireAdmin, (req, res) => {
  if (!rateLimit('pw:' + req.socket.remoteAddress, 10, 10 * 60_000)) return res.status(429).json({ error: 'Zu viele Versuche' });
  const { current, next } = req.body || {};
  if (!checkPassword(req.user, current)) return res.status(403).json({ error: 'Aktuelles Passwort ist falsch' });
  if (!validPassword(next)) return res.status(400).json({ error: 'Das neue Passwort muss 6 bis 100 Zeichen lang sein' });
  setPassword(req.user, next);
  dropSessions(req.user.id, cookies(req).woc_admin); // andere Geräte abmelden
  res.json({ ok: true });
});

// Benutzerverwaltung (nur Global Admin)
app.post('/api/admin/users', requireGlobal, (req, res) => {
  const name = clean(req.body?.name, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Bitte einen Namen angeben' });
  if (db.users.length >= 50) return res.status(400).json({ error: 'Zu viele Benutzer' });
  if (db.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Diesen Namen gibt es schon' });
  const user = { id: newId(), name, role: 'admin', avatar: null, pass: null };
  db.users.push(user);
  save();
  res.status(201).json({ user: publicUser(user) });
});

app.patch('/api/admin/users/:id', requireGlobal, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const { name, password, role } = req.body || {};
  if (password !== undefined && !validPassword(password)) return res.status(400).json({ error: 'Das Passwort muss 6 bis 100 Zeichen lang sein' });
  if (role !== undefined) {
    if (!['admin', 'global'].includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (user.role === 'global' && role !== 'global' && db.users.filter((u) => u.role === 'global').length < 2) {
      return res.status(409).json({ error: 'Es muss mindestens einen Global Admin geben' });
    }
    user.role = role;
  }
  if (typeof name === 'string' && clean(name, 40).length >= 2) user.name = clean(name, 40);
  if (password !== undefined) {
    setPassword(user, password);
    dropSessions(user.id, cookies(req).woc_admin);
  }
  save();
  res.json({ user: publicUser(user) });
});

app.delete('/api/admin/users/:id', requireGlobal, async (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (user === req.user) return res.status(409).json({ error: 'Du kannst dich nicht selbst löschen' });
  db.users = db.users.filter((u) => u !== user);
  dropSessions(user.id);
  save();
  res.json({ ok: true });
});

// Profilbild: der Global Admin für alle, jeder für sich selbst
app.put('/api/admin/users/:id/avatar', requireAdmin, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }), async (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (req.user.role !== 'global' && req.user !== user) return res.status(403).json({ error: 'Das darf nur der Global Admin' });
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[contentType(req)];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 50) return res.status(415).json({ error: 'Bitte ein JPG-, PNG- oder WebP-Bild hochladen' });
  const file = `u-${crypto.randomBytes(6).toString('hex')}${ext}`;
  await fsp.writeFile(path.join(AVATARS, file), req.body, { flag: 'wx' });
  if (user.avatar && user.avatar.startsWith('u-')) await fsp.rm(path.join(AVATARS, user.avatar), { force: true });
  user.avatar = file;
  save();
  res.json({ user: publicUser(user) });
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
    quiz: { active: db.quiz.active, showBoard: db.quiz.showBoard, questions: db.quiz.questions, scores: quizBoard(500) },
    users: db.users.map(publicUser),
    me: publicUser(req.user),
    grid: { cols: db.settings.gridCols, rows: db.settings.gridRows },
    visitorsOnline: [...clients].filter((c) => c.role === 'visitor').length,
    urls: {
      portal: `${publicBase(req)}/app`,
      quiz: `http://${host}:${PORT}/quiz`,
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
  settingsVersion = Date.now();
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
    return res.status(415).json({ error: kind === 'frames' ? 'Rahmen müssen JPG, PNG, WebP oder SVG sein' : 'Bitte JPG, PNG, WebP, SVG oder ein Video (MP4, WebM) hochladen' });
  }
  const base = clean(String(req.query.name || ''), 80).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-').replace(/^-+|-+$/g, '') || kind.slice(0, -1);
  let file = base + ext;
  for (let n = 2; fs.existsSync(path.join(ASSET_DIRS[kind], file)); n++) file = `${base}-${n}${ext}`;
  await saveStream(req, path.join(ASSET_DIRS[kind], file), ext === '.mp4' || ext === '.webm' ? MAX_MEDIA : MAX_ASSET);
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
  } else if (action === 'random') {
    const list = db.items.filter((i) => i.onWall);
    if (!list.length) return res.status(409).json({ error: 'Es ist noch nichts auf der Wall' });
    broadcast('command', { action: 'show', id: list[crypto.randomInt(list.length)].id }, ['wall']);
  } else if (action === 'close' || action === 'dvd' || action === 'wake') {
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
    active: db.hunt.active, endsAt: db.hunt.endsAt, winnerId: db.hunt.winnerId, showWinner: db.hunt.showWinner, now,
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
    endsAt: db.hunt.active ? db.hunt.endsAt : null,
    ended: !db.hunt.active && !!db.hunt.endsAt && db.hunt.endsAt <= Date.now(),
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
    if (db.hunt.endsAt && db.hunt.endsAt <= Date.now()) return res.status(409).json({ error: 'Die Color-Hunt-Challenge ist schon vorbei.' });
    p.startedAt = Date.now();
    p.deadline = Math.min(p.startedAt + p.duration, db.hunt.endsAt || Infinity);
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
  const { active, winnerId, showWinner, countdownMinutes, extendMinutes, countdown } = req.body || {};
  const minutes = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
  if (countdownMinutes !== undefined) {
    const m = minutes(countdownMinutes, 1, 600);
    if (m === undefined) return res.status(400).json({ error: 'Bitte 1 bis 600 Minuten angeben' });
    db.hunt.endsAt = Date.now() + m * 60_000;
    db.hunt.active = true; // Countdown starten öffnet den Color Hunt
  }
  if (extendMinutes !== undefined) {
    const m = minutes(extendMinutes, -600, 600);
    if (m === undefined || !m) return res.status(400).json({ error: 'Ungültige Minutenzahl' });
    if (!db.hunt.endsAt || !db.hunt.active) return res.status(409).json({ error: 'Es läuft gerade kein Countdown' });
    db.hunt.endsAt = Math.max(Date.now() + 5_000, db.hunt.endsAt + m * 60_000);
  }
  if (countdown === null) db.hunt.endsAt = null; // Countdown stoppen, Color Hunt bleibt offen
  if (typeof active === 'boolean') {
    db.hunt.active = active;
    if (!active || (db.hunt.endsAt && db.hunt.endsAt <= Date.now())) db.hunt.endsAt = null;
  }
  if (winnerId === null) { db.hunt.winnerId = null; db.hunt.showWinner = false; }
  if (typeof winnerId === 'string') {
    if (!db.hunt.players.some((p) => p.id === winnerId)) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
    db.hunt.winnerId = winnerId;
    db.hunt.showWinner = true;
  }
  if (typeof showWinner === 'boolean') db.hunt.showWinner = showWinner && !!db.hunt.winnerId;
  capDeadlines();
  scheduleHuntEnd();
  huntChanged();
  res.json({ hunt: adminHunt() });
});

/** Laufende Teilnehmer haben höchstens bis zum Ende des Countdowns Zeit. */
function capDeadlines() {
  const now = Date.now();
  for (const p of db.hunt.players) {
    if (!p.startedAt || p.finishedAt || p.deadline < now) continue; // schon fertig
    p.deadline = Math.max(now, Math.min(p.startedAt + p.duration, db.hunt.endsAt || Infinity));
  }
}
let huntEndTimer = null;
function scheduleHuntEnd() {
  clearTimeout(huntEndTimer);
  if (!db.hunt.active || !db.hunt.endsAt) return;
  const left = db.hunt.endsAt - Date.now();
  if (left <= 0) return endHunt();
  huntEndTimer = setTimeout(scheduleHuntEnd, Math.min(left, 60 * 60_000)); // lange Wartezeiten in Etappen
}
/** Countdown abgelaufen: Color Hunt schließen, laufende Teilnehmer geben automatisch ab. */
function endHunt() {
  db.hunt.active = false;
  capDeadlines();
  huntChanged();
}

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
  db.hunt = { ...emptyHunt(), active: db.hunt.active, endsAt: db.hunt.endsAt };
  huntChanged();
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Quiz (iPad)                                                         */
/* ------------------------------------------------------------------ */
const quizSessions = new Map(); // id -> laufende Runde (nur im Speicher)
const quizChanged = () => { save(); broadcast('quiz', {}, ['wall', 'admin', 'quiz']); };
function quizBoard(limit) {
  return [...db.quiz.scores]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, limit)
    .map((sc, i) => ({ rank: i + 1, id: sc.id, name: sc.name, score: sc.score, correct: sc.correct, total: sc.total, at: sc.at }));
}
const quizQuestion = (sess) => {
  const q = sess.questions[sess.index];
  return { n: sess.index + 1, total: sess.questions.length, text: q.text, answers: q.answers, seconds: sess.seconds };
};

app.use('/api/quiz', express.json({ limit: '10kb' }));

app.get('/api/quiz/state', (_req, res) => {
  res.json({
    active: db.quiz.active && db.quiz.questions.length > 0, title: db.settings.title,
    count: Math.min(db.settings.quizCount, db.quiz.questions.length), seconds: db.settings.quizSeconds, board: quizBoard(10),
  });
});

app.post('/api/quiz/start', (req, res) => {
  if (!db.quiz.active || !db.quiz.questions.length) return res.status(403).json({ error: 'Das Quiz ist gerade nicht geöffnet.' });
  if (!rateLimit('quiz:' + req.socket.remoteAddress, 60, 10 * 60_000)) return res.status(429).json({ error: 'Bitte kurz warten' });
  const name = clean(req.body?.name, 20).replace(/\s+/g, ' ');
  if (name.length < 2) return res.status(400).json({ error: 'Bitte gib deinen Namen ein.' });
  const pool = [...db.quiz.questions];
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const sess = {
    id: crypto.randomBytes(18).toString('base64url'), name, index: 0, score: 0, correct: 0,
    questions: pool.slice(0, db.settings.quizCount).map((q) => ({ text: q.text, answers: [...q.answers], correct: q.correct })),
    seconds: db.settings.quizSeconds, askedAt: Date.now(), expires: Date.now() + 30 * 60_000,
  };
  quizSessions.set(sess.id, sess);
  res.status(201).json({ session: sess.id, question: quizQuestion(sess) });
});

app.post('/api/quiz/answer', (req, res) => {
  const sess = quizSessions.get(String(req.body?.session || ''));
  if (!sess) return res.status(410).json({ error: 'Diese Runde ist abgelaufen. Bitte starte neu.' });
  const q = sess.questions[sess.index];
  const elapsed = Math.max(0, Date.now() - sess.askedAt);
  const limit = sess.seconds * 1000;
  const answer = Number(req.body?.answer);
  const correct = answer === q.correct && elapsed <= limit + 2000;
  const points = correct ? 100 + Math.round(100 * Math.max(0, 1 - elapsed / limit)) : 0;
  sess.score += points;
  if (correct) sess.correct++;
  sess.index++;
  const out = { correct, correctIndex: q.correct, points, score: sess.score, done: sess.index >= sess.questions.length };
  if (out.done) {
    quizSessions.delete(sess.id);
    const entry = { id: newId(), name: sess.name, score: sess.score, correct: sess.correct, total: sess.questions.length, at: Date.now() };
    db.quiz.scores.push(entry);
    if (db.quiz.scores.length > 2000) db.quiz.scores = quizBoard(2000).map(({ rank, ...sc }) => sc);
    quizChanged();
    out.result = {
      name: entry.name, score: entry.score, correct: entry.correct, total: entry.total, id: entry.id,
      rank: quizBoard(Infinity).find((b) => b.id === entry.id).rank, players: db.quiz.scores.length, board: quizBoard(10),
    };
  } else {
    sess.askedAt = Date.now() + 2500; // die Auflösung wird kurz gezeigt, erst danach läuft die Zeit
    out.question = quizQuestion(sess);
  }
  res.json(out);
});

app.put('/api/admin/quiz', requireAdmin, (req, res) => {
  const { active, showBoard } = req.body || {};
  if (typeof active === 'boolean') db.quiz.active = active;
  if (typeof showBoard === 'boolean') db.quiz.showBoard = showBoard;
  quizChanged();
  res.json({ ok: true });
});

function parseQuestion(body) {
  const text = clean(body?.text, 200);
  const answers = Array.isArray(body?.answers) ? body.answers.map((a) => clean(a, 80)).filter(Boolean) : [];
  const correct = Number(body?.correct);
  if (text.length < 3) return { error: 'Bitte eine Frage eingeben' };
  if (answers.length < 2 || answers.length > 4) return { error: 'Bitte 2 bis 4 Antworten eingeben' };
  if (!Number.isInteger(correct) || correct < 0 || correct >= answers.length) return { error: 'Bitte die richtige Antwort markieren' };
  return { text, answers, correct };
}
app.post('/api/admin/quiz/questions', requireAdmin, (req, res) => {
  const q = parseQuestion(req.body);
  if (q.error) return res.status(400).json(q);
  if (db.quiz.questions.length >= 300) return res.status(400).json({ error: 'Zu viele Fragen' });
  db.quiz.questions.push({ id: newId(), ...q });
  quizChanged();
  res.status(201).json({ ok: true });
});
app.put('/api/admin/quiz/questions/:id', requireAdmin, (req, res) => {
  const old = db.quiz.questions.find((x) => x.id === req.params.id);
  if (!old) return res.status(404).json({ error: 'Frage nicht gefunden' });
  const q = parseQuestion(req.body);
  if (q.error) return res.status(400).json(q);
  Object.assign(old, q);
  quizChanged();
  res.json({ ok: true });
});
app.delete('/api/admin/quiz/questions/:id', requireAdmin, (req, res) => {
  db.quiz.questions = db.quiz.questions.filter((x) => x.id !== req.params.id);
  quizChanged();
  res.json({ ok: true });
});
app.delete('/api/admin/quiz/scores/:id', requireAdmin, (req, res) => {
  db.quiz.scores = db.quiz.scores.filter((x) => x.id !== req.params.id);
  quizChanged();
  res.json({ ok: true });
});
app.post('/api/admin/quiz/reset', requireAdmin, (_req, res) => {
  db.quiz.scores = [];
  quizChanged();
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Verbund-Wall (experimentell)                                        */
/* Mehrere Bildschirme (z. B. iPads nebeneinander) zeigen zusammen     */
/* eine große Wall. Die Bewegung wird hier auf dem Server berechnet    */
/* und an alle Bildschirme gesendet, damit Kacheln von einem           */
/* Bildschirm zum nächsten wandern.                                    */
/* ------------------------------------------------------------------ */
const grid = { tiles: new Map(), timer: null, tick: 0, last: 0 };
const GRID_GAP = 3;
const gridRand = (a, b) => a + Math.random() * (b - a);
function gridSize() {
  const [aw, ah] = db.settings.gridAspect.split(':').map(Number);
  const sh = 900, sw = Math.round(sh * aw / ah);
  return { sw, sh, cols: db.settings.gridCols, rows: db.settings.gridRows, W: sw * db.settings.gridCols, H: sh * db.settings.gridRows };
}
function gridAdd(item, size) {
  const ratio = item.ratio || (item.kind === 'photo' ? 9 / 16 : item.kind === 'video' ? 16 / 10 : 1);
  const base = db.settings.thumbSize * 0.85 * gridRand(0.85, 1.2);
  const w = base * Math.sqrt(ratio), h = w / ratio;
  let best = null;
  for (let i = 0; i < 60; i++) {
    const x = gridRand(w / 2, size.W - w / 2), y = gridRand(h / 2, size.H - h / 2);
    let cost = 0;
    for (const t of grid.tiles.values()) {
      const px = (w + t.w) / 2 + GRID_GAP - Math.abs(t.x - x), py = (h + t.h) / 2 + GRID_GAP - Math.abs(t.y - y);
      if (px > 0 && py > 0) cost += Math.min(px, py);
    }
    if (!best || cost < best.cost) best = { x, y, cost };
    if (!cost) break;
  }
  const dir = gridRand(0, Math.PI * 2), v = gridRand(16, 32);
  grid.tiles.set(item.id, { id: item.id, thumbSize: db.settings.thumbSize, x: best.x, y: best.y, w, h, m: w * h, v, vx: Math.cos(dir) * v, vy: Math.sin(dir) * v, phase: gridRand(0, 6.28) });
}
function gridSync(size) {
  const wallItems = db.items.filter((i) => i.onWall);
  const ids = new Set(wallItems.map((i) => i.id));
  for (const [id, t] of grid.tiles) if (!ids.has(id) || t.thumbSize !== db.settings.thumbSize) grid.tiles.delete(id);
  const max = db.settings.wallMaxItems;
  while (grid.tiles.size > max) grid.tiles.delete(grid.tiles.keys().next().value);
  const hidden = wallItems.filter((i) => !grid.tiles.has(i.id)).sort(() => Math.random() - 0.5);
  while (grid.tiles.size < max && hidden.length) gridAdd(hidden.pop(), size);
  // mehr Inhalte als Plätze: gelegentlich eine Kachel austauschen
  if (hidden.length && grid.tick % 270 === 0) {
    const keys = [...grid.tiles.keys()];
    grid.tiles.delete(keys[Math.floor(Math.random() * keys.length)]);
    gridAdd(hidden.pop(), size);
  }
}
function gridStep() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - grid.last) / 1000);
  grid.last = now;
  const size = gridSize();
  if (grid.tick % 30 === 0) gridSync(size);
  grid.tick++;
  const list = [...grid.tiles.values()];
  const speed = db.settings.speed, t = now / 1000;
  for (const b of list) {
    let s = Math.hypot(b.vx, b.vy);
    if (s < 0.01) { b.vx = 1; b.vy = 0; s = 1; }
    const target = s + (b.v - s) * Math.min(1, dt * 0.7);
    const turn = Math.sin(t * 0.23 + b.phase) * 0.12 * dt;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const nx = (b.vx * cos - b.vy * sin) / s, ny = (b.vx * sin + b.vy * cos) / s;
    b.vx = nx * target; b.vy = ny * target;
    b.x += b.vx * dt * speed; b.y += b.vy * dt * speed;
    const mx = b.w / 2 + 4, my = b.h / 2 + 4;
    if (b.x < mx) { b.x = mx; b.vx = Math.abs(b.vx); }
    if (b.x > size.W - mx) { b.x = size.W - mx; b.vx = -Math.abs(b.vx); }
    if (b.y < my) { b.y = my; b.vy = Math.abs(b.vy); }
    if (b.y > size.H - my) { b.y = size.H - my; b.vy = -Math.abs(b.vy); }
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const px = (a.w + b.w) / 2 + GRID_GAP - Math.abs(dx);
      if (px <= 0) continue;
      const py = (a.h + b.h) / 2 + GRID_GAP - Math.abs(dy);
      if (py <= 0) continue;
      let nx = 0, ny = 0, pen;
      if (px < py) { nx = dx < 0 ? -1 : 1; pen = px; } else { ny = dy < 0 ? -1 : 1; pen = py; }
      const ia = 1 / a.m, ib = 1 / b.m, sum = ia + ib;
      const push = Math.min(pen, 260 * dt) / sum;
      a.x -= nx * push * ia; a.y -= ny * push * ia;
      b.x += nx * push * ib; b.y += ny * push * ib;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const jImp = -1.9 * rv / sum;
        a.vx -= jImp * nx * ia; a.vy -= jImp * ny * ia;
        b.vx += jImp * nx * ib; b.vy += jImp * ny * ib;
      }
    }
  }
  if (grid.tick % 3 === 0) { // ~10x pro Sekunde senden
    const r = (n) => Math.round(n * 10) / 10;
    const data = { ...size, tiles: list.map((b) => [b.id, r(b.x), r(b.y), r(b.w), r(b.h), r(b.vx * speed), r(b.vy * speed), r(b.phase)]) };
    for (const c of clients) if (c.grid) send(c, 'grid', data);
  }
}
/** Die Berechnung läuft nur, solange mindestens ein Verbund-Bildschirm verbunden ist. */
function gridCheck() {
  const needed = [...clients].some((c) => c.grid);
  if (needed && !grid.timer) {
    grid.last = Date.now();
    grid.tick = 0;
    grid.timer = setInterval(gridStep, 33);
  } else if (!needed && grid.timer) {
    clearInterval(grid.timer);
    grid.timer = null;
  }
}

/* ------------------------------------------------------------------ */
/* QR-Codes im Browser erzeugen (Teilen-Dialog im Admin-Panel).       */
/* Das Paket „qrcode“ wird beim ersten Abruf für den Browser gebündelt.*/
/* ------------------------------------------------------------------ */
let qrBundle = null;
function buildQrBundle() {
  const base = path.dirname(require.resolve('qrcode/package.json'));
  const files = {};
  const add = (abs) => {
    if (files[abs]) return;
    const src = fs.readFileSync(abs, 'utf8');
    files[abs] = src;
    for (const m of src.matchAll(/require\('([^']+)'\)/g)) {
      add(m[1].startsWith('.') ? require.resolve(path.resolve(path.dirname(abs), m[1])) : require.resolve(m[1], { paths: [base] }));
    }
  };
  const entries = [path.join(base, 'lib/core/qrcode.js'), path.join(base, 'lib/renderer/svg-tag.js')];
  entries.forEach(add);
  const ids = Object.keys(files);
  const mods = ids.map((abs) => {
    const deps = {};
    for (const m of files[abs].matchAll(/require\('([^']+)'\)/g)) {
      deps[m[1]] = ids.indexOf(m[1].startsWith('.') ? require.resolve(path.resolve(path.dirname(abs), m[1])) : require.resolve(m[1], { paths: [base] }));
    }
    return `[function (require, module, exports) {\n${files[abs]}\n}, ${JSON.stringify(deps)}]`;
  });
  return `/* qrcode ${require('qrcode/package.json').version} (MIT) – für den Browser gebündelt von server.js */
(function () {
  var mods = [${mods.join(',\n')}], cache = {};
  function load(i) {
    if (cache[i]) return cache[i].exports;
    var m = cache[i] = { exports: {} };
    mods[i][0](function (n) { return load(mods[i][1][n]); }, m, m.exports);
    return m.exports;
  }
  var core = load(${ids.indexOf(entries[0])}), svg = load(${ids.indexOf(entries[1])});
  window.QRLite = { svg: function (text, opts) { opts = opts || {}; return svg.render(core.create(text, { errorCorrectionLevel: opts.ecl || 'M' }), { margin: opts.margin == null ? 2 : opts.margin }); } };
})();\n`;
}
app.get('/js/qrcode.js', (_req, res) => {
  try { qrBundle = qrBundle || buildQrBundle(); } catch (e) { console.error('QR-Bündel:', e.message); return res.status(500).end(); }
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(qrBundle);
});

/* ------------------------------------------------------------------ */
/* Besucher-App: Programm, Challenges, Shop, Feedback (lib/portal.js)  */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Paket teilen: alles als ZIP (lib/pack.js)                           */
/* ------------------------------------------------------------------ */
require('./lib/pack')({
  app, requireGlobal, getDb: () => db, ROOT, UPLOADS, ASSETS,
  startPasswordActive: () => !!startPassword, globalAdminName: () => globalAdmin().name,
});

require('./lib/portal')({
  app, express, getDb: () => db, settings: () => db.settings, save, broadcast, requireAdmin, isAdmin, clean, newId, sha,
  cookies, rateLimit, sameOrigin, publicBase, QRCode, escapeHtml, UPLOADS, contentType, page, ROOT, logoUrl,
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
  scheduleHuntEnd(); // falls der Server während eines Countdowns neu gestartet wurde
  await syncMediaFolder();
  let watchTimer = null;
  try {
    fs.watch(MEDIA_DIR, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => syncMediaFolder().catch((e) => console.error(e)), 1500);
    });
  } catch { /* Ordnerüberwachung nicht verfügbar – Abgleich erfolgt beim Öffnen des Admin-Panels */ }
  const ip = lanIp();
  await new Promise((resolve) => http.createServer(app)
    .on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} ist schon belegt. Läuft die Wall of Content schon in einem anderen Fenster?\n` +
          `  Sonst mit einem anderen Port starten, z. B.:  PORT=3001 npm start\n`);
      } else {
        console.error('\n  Der Server konnte nicht starten:', e.message, '\n');
      }
      process.exit(1);
    })
    .listen(PORT, resolve));
  let httpsOk = false;
  if (HTTPS_PORT) {
    try {
      const tls = await certificate();
      await new Promise((resolve, reject) => https.createServer(tls, app).on('error', reject).listen(HTTPS_PORT, resolve));
      httpsOk = true;
    } catch (e) {
      console.error('HTTPS konnte nicht gestartet werden:', e.code === 'EADDRINUSE' ? `Port ${HTTPS_PORT} ist schon belegt (anderen Port mit HTTPS_PORT=3444 wählen).` : e.message);
    }
  }
  const stationUrl = httpsOk ? `https://${ip}:${HTTPS_PORT}/station` : `http://${ip}:${PORT}/station`;
  console.log(`
  Wall of Content läuft

  Wall (Bildschirm):   http://localhost:${PORT}/        (im Netzwerk: http://${ip}:${PORT}/)
  Fotostation (Handy): ${stationUrl}
  Admin-Panel:         http://localhost:${PORT}/admin   (im Netzwerk: http://${ip}:${PORT}/admin)
  Color Hunt (Gäste):  ${db.settings.publicUrl || `http://${ip}:${PORT}`}/hunt
  Quiz (iPad):         http://${ip}:${PORT}/quiz
  Besucher-App:        ${db.settings.publicUrl || `http://${ip}:${PORT}`}/app   (Programm, Challenges, Shop, Feedback)

  Anmeldung im Admin-Panel als ${globalAdmin().name} (Global Admin)
  Passwort:            ${process.env.ADMIN_PASSWORD ? '(aus ADMIN_PASSWORD)' : startPassword ? `${startPassword}   (Startpasswort, steht auch in ${pwFile.startsWith(ROOT) ? path.relative(ROOT, pwFile) : pwFile})` : '(wurde im Admin-Panel geändert)'}
${httpsOk ? '\n  Hinweis: Die Kamera im Handy-Browser funktioniert nur über HTTPS. Beim ersten Öffnen der\n  Fotostation die Zertifikatswarnung einmalig bestätigen ("Erweitert" -> "Trotzdem fortfahren").\n' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
