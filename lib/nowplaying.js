'use strict';
/**
 * „Läuft gerade“: zeigt den aktuellen Song auf der Wall (drehende Schallplatte mit Cover und Titel).
 *
 * Quellen (Einstellung nowPlayingSource):
 *   mac    – Spotify oder Apple Music auf diesem Mac (per AppleScript/osascript, inkl. Cover)
 *   datei  – Textdatei einer DJ-Software (VirtualDJ schreibt sie selbst, für Serato/Traktor/Rekordbox z. B. per
 *            „What's Now Playing“). Gelesen wird die letzte sinnvolle Zeile, Format „Interpret - Titel“.
 *   auto   – erst Spotify/Apple Music (wenn sie gerade spielen), sonst die DJ-Datei
 *
 *   GET /api/nowplaying          – aktueller Song (auch in /api/state)
 *   GET /api/nowplaying/cover    – Cover des aktuellen Songs
 *   GET /api/admin/nowplaying    – Status für das Admin-Panel (gefundene Quellen, Fehler)
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const POLL_MS = 3000;
const FILE_FRESH_MS = 45 * 60_000; // ältere Einträge in der DJ-Datei gelten nicht mehr als „läuft gerade“
const MAX_COVER = 8 * 1024 * 1024;

/** Kandidaten für die DJ-Datei, falls kein Pfad eingestellt ist (VirtualDJ legt sie selbst an). */
function defaultFiles() {
  const h = os.homedir();
  return [
    path.join(h, 'Documents', 'VirtualDJ', 'History', 'tracklist.txt'),
    path.join(h, 'Library', 'Application Support', 'VirtualDJ', 'History', 'tracklist.txt'),
    path.join(h, 'AppData', 'Local', 'VirtualDJ', 'History', 'tracklist.txt'),
  ];
}

/** Eine Zeile aus einer DJ-Datei in { artist, title } zerlegen. */
function parseLine(line) {
  let s = String(line || '').replace(/^\uFEFF/, '').trim();
  if (!s || s.startsWith('#')) return null;
  s = s.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*[:\-–|]?\s*/, ''); // „21:03 : …“ (VirtualDJ) bzw. „[21:03] …“
  if (/[\\/]/.test(s) && /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|alac)$/i.test(s)) s = s.split(/[\\/]/).pop(); // Dateipfad
  s = s.replace(/\.(mp3|m4a|aac|wav|aiff?|flac|ogg|alac)$/i, '').trim();
  if (!s) return null;
  const m = s.split(/\s+[-–—]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' – ').trim() };
  return { artist: '', title: s };
}

/** Letzte sinnvolle Zeile der Datei (liest nur das Ende, auch bei sehr langen Verlaufsdateien). */
async function readLastEntry(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size, mtimeMs } = await fh.stat();
    const len = Math.min(size, 16384);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    let text = buf.toString('utf8');
    if (text.includes('\u0000')) text = buf.toString('utf16le'); // manche Windows-Programme schreiben UTF-16
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const p = parseLine(lines[i]);
      if (p) return { ...p, mtimeMs };
    }
    return null;
  } finally {
    await fh.close();
  }
}

const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
});
const isRunning = async (name) => (await run('pgrep', ['-x', name])) !== null;

// AppleScript je App: liefert Tab-getrennt Zustand, Titel, Interpret, Album, Cover-URL
const SPOTIFY = `tell application "Spotify"
  set t to current track
  return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & (artwork url of t)
end tell`;
const MUSIC = `tell application "Music"
  set t to current track
  return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & ""
end tell`;
const musicCover = (file) => `tell application "Music"
  set d to raw data of artwork 1 of current track
end tell
set fh to open for access (POSIX file "${file.replace(/["\\]/g, '')}") with write permission
set eof fh to 0
write d to fh
close access fh
return "ok"`;

async function readMacApp(app) {
  const out = await run('osascript', ['-e', app === 'spotify' ? SPOTIFY : MUSIC]);
  if (!out) return null;
  const [state, title, artist, album, cover] = out.replace(/\n$/, '').split('\t');
  if (!title) return null;
  return { app, playing: /playing/i.test(state), title, artist: artist || '', album: album || '', coverUrl: cover || '' };
}

function download(url, max) {
  return new Promise((resolve) => {
    if (!/^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(url)) return resolve(null); // nur Spotify-Cover
    https.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > max) res.destroy(); else chunks.push(c); });
      res.on('end', () => resolve(n <= max ? { buf: Buffer.concat(chunks), type: res.headers['content-type'] || 'image/jpeg' } : null));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null)).on('timeout', function onTimeout() { this.destroy(); resolve(null); });
  });
}

module.exports = function nowPlaying(ctx) {
  const { app, getDb, broadcast, requireAdmin, DATA } = ctx;
  const isMac = process.platform === 'darwin';
  const coverFile = path.join(DATA, '.cover-music');
  let current = null;        // { title, artist, album, source, playing, cover, at }
  let cover = null;          // { buf, type } des aktuellen Songs
  let status = { mac: isMac ? 'nicht gefunden' : 'nur auf dem Mac', file: null, fileFound: false, error: null };
  let busy = false;
  let version = 1; // steigt bei jeder Änderung; die Wall nimmt immer die neuere Meldung

  const key = (s) => (s ? `${s.source}|${s.artist}|${s.title}|${s.playing}` : '');
  const pub = () => (current ? { ...current, coverUrl: current.cover ? `/api/nowplaying/cover?v=${encodeURIComponent(current.at)}` : null } : null);

  async function fromMac() {
    if (!isMac) return null;
    const found = [];
    for (const [proc, id] of [['Spotify', 'spotify'], ['Music', 'music']]) {
      if (!(await isRunning(proc))) continue;
      const r = await readMacApp(id);
      if (r) found.push(r);
    }
    status.mac = found.length ? found.map((f) => `${f.app === 'spotify' ? 'Spotify' : 'Apple Music'} (${f.playing ? 'spielt' : 'pausiert'})`).join(', ')
      : 'Spotify/Apple Music laufen nicht';
    return found.find((f) => f.playing) || null;
  }

  async function fromFile() {
    const s = getDb().settings;
    const list = s.nowPlayingFile ? [s.nowPlayingFile.replace(/^~(?=\/|$)/, os.homedir())] : defaultFiles();
    for (const f of list) {
      try {
        const e = await readLastEntry(f);
        status.file = f;
        status.fileFound = true;
        if (!e) return null;
        if (Date.now() - e.mtimeMs > FILE_FRESH_MS) return null;
        return e;
      } catch { /* nächste Datei */ }
    }
    status.file = s.nowPlayingFile || null;
    status.fileFound = false;
    return null;
  }

  async function loadCover(next, song) {
    let c = null;
    if (next.coverUrl) c = await download(next.coverUrl, MAX_COVER);
    else if (next.source === 'music') {
      const ok = await run('osascript', ['-e', musicCover(coverFile)]);
      if (ok) { try { c = { buf: await fsp.readFile(coverFile), type: 'image/jpeg' }; } catch { c = null; } }
    }
    if (!c || current !== song) return; // inzwischen anderer Song
    cover = c;
    current = { ...current, cover: true };
    version++; broadcast('nowplaying', { song: pub(), v: version });
  }

  async function poll() {
    if (busy) return;
    const s = getDb().settings;
    if (!s.nowPlaying) { if (current) { current = null; cover = null; version++; broadcast('nowplaying', { song: null, v: version }); } return; }
    busy = true;
    try {
      let next = null;
      const src = s.nowPlayingSource || 'auto';
      if (src !== 'datei') {
        const m = await fromMac();
        if (m) next = { title: m.title, artist: m.artist, album: m.album, source: m.app, playing: true, coverUrl: m.coverUrl };
      }
      if (!next && src !== 'mac') {
        const f = await fromFile();
        if (f) next = { title: f.title, artist: f.artist, album: '', source: 'datei', playing: true };
      }
      status.error = null;
      if (key(next) === key(current)) return;
      const sameSong = next && current && next.title === current.title && next.artist === current.artist;
      if (!sameSong) cover = null;
      current = next ? { title: next.title, artist: next.artist, album: next.album, source: next.source, playing: next.playing, cover: !!cover, at: sameSong ? current.at : Date.now() } : null;
      version++; broadcast('nowplaying', { song: pub(), v: version }); // Titel sofort zeigen …
      if (next && !sameSong) loadCover(next, current); // … Cover kommt nach, sobald es geladen ist
    } catch (e) {
      status.error = e.message;
    } finally {
      busy = false;
    }
  }
  setInterval(poll, POLL_MS).unref();
  setTimeout(poll, 500);

  app.get('/api/nowplaying', (_req, res) => res.json({ song: pub() }));
  app.get('/api/nowplaying/cover', (_req, res) => {
    if (!cover) return res.status(404).end();
    // Bildtyp anhand der ersten Bytes, nie etwas anderes als ein Bild ausliefern
    const b = cover.buf;
    const type = b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : null;
    if (!type) return res.status(404).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(b);
  });
  app.get('/api/admin/nowplaying', requireAdmin, async (_req, res) => {
    await poll();
    res.json({ song: pub(), status: { ...status, platform: process.platform, defaults: defaultFiles() } });
  });

  return { current: pub, poll, version: () => version };
};
module.exports.parseLine = parseLine;
