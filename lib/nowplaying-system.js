'use strict';
/**
 * Was spielt gerade auf diesem Rechner? – auch Musik im Browser (Spotify Web, YouTube Music, SoundCloud …).
 *
 *   Linux   – MPRIS über D-Bus (playerctl, sonst gdbus). Chrome, Chromium, Brave, Edge, Firefox, Spotify, VLC, Rhythmbox …
 *             melden sich dort selbst; Web-Player liefern Titel, Interpret und Cover über die Media-Session.
 *   macOS   – Spotify- und Musik-App per AppleScript, „nowplaying-cli“ falls installiert, und offene Tabs von Chrome,
 *             Brave, Edge, Arc, Vivaldi und Safari mit Spotify Web / YouTube Music / SoundCloud (Titel aus dem Tab).
 *   Windows – Medien-Sitzungen von Windows (wie im Lautstärke-Overlay) per PowerShell.
 *
 * Ergebnis: { players: [{ name, playing, title, artist, album, artUrl }], hint }
 */
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout) => {
    if (err) resolve(err.code === 'ENOENT' ? { missing: true } : null);
    else resolve(String(stdout));
  });
});
const text = (r) => (typeof r === 'string' ? r : null);

/* ======================= Linux: MPRIS ======================= */
const PLAYER_NAMES = {
  chromium: 'Chromium', chrome: 'Chrome', brave: 'Brave', edge: 'Edge', msedge: 'Edge', vivaldi: 'Vivaldi', opera: 'Opera',
  firefox: 'Firefox', spotify: 'Spotify', vlc: 'VLC', rhythmbox: 'Rhythmbox', strawberry: 'Strawberry', elisa: 'Elisa',
  audacious: 'Audacious', clementine: 'Clementine', lollypop: 'Lollypop', tidal: 'TIDAL', youtube: 'YouTube Music',
};
const prettyPlayer = (bus) => {
  const id = bus.replace(/^org\.mpris\.MediaPlayer2\./, '').split('.')[0].toLowerCase();
  for (const [k, v] of Object.entries(PLAYER_NAMES)) if (id.includes(k)) return v;
  return id.charAt(0).toUpperCase() + id.slice(1);
};

/** Wert eines Schlüssels aus der GVariant-Textausgabe von gdbus lesen (String oder erster Eintrag einer Liste). */
function gv(out, key) {
  const i = out.indexOf(`'${key}': <`);
  if (i < 0) return '';
  let s = out.slice(i + key.length + 5).replace(/^(@as |objectpath |@s )/, '');
  if (s.startsWith('[')) s = s.slice(1).trimStart();
  const q = s[0];
  if (q !== "'" && q !== '"') return '';
  let r = '';
  for (let j = 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { const n = s[++j]; r += n === 'n' ? ' ' : n; continue; }
    if (c === q) break;
    r += c;
  }
  return r.trim();
}

async function linuxPlayerctl() {
  const fmt = '{{status}}\t{{playerName}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}';
  const r = await run('playerctl', ['-a', 'metadata', '--format', fmt], 3000);
  if (r && r.missing) return null; // nicht installiert → gdbus
  const out = text(r);
  if (out === null) return []; // keine Player
  return out.split('\n').filter(Boolean).map((line) => {
    const [st, name, title, artist, album, art] = line.split('\t');
    return { name: prettyPlayer('org.mpris.MediaPlayer2.' + (name || '')), playing: st === 'Playing', title: title || '', artist: artist || '', album: album || '', artUrl: art || '' };
  });
}

async function linuxGdbus() {
  const call = (dest, iface, prop) => run('gdbus', ['call', '--session', '--dest', dest, '--object-path', '/org/mpris/MediaPlayer2',
    '--method', 'org.freedesktop.DBus.Properties.Get', iface, prop], 2500);
  const names = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames'], 2500);
  if (names && names.missing) return { missing: true };
  const list = text(names);
  if (list === null) return { noBus: true };
  const buses = [...list.matchAll(/'(org\.mpris\.MediaPlayer2\.[^']+)'/g)].map((m) => m[1]);
  const players = [];
  for (const bus of buses.slice(0, 12)) {
    const [st, meta] = await Promise.all([call(bus, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus'), call(bus, 'org.mpris.MediaPlayer2.Player', 'Metadata')]);
    const m = text(meta) || '';
    players.push({
      name: prettyPlayer(bus), playing: /'Playing'/.test(text(st) || ''),
      title: gv(m, 'xesam:title'), artist: gv(m, 'xesam:artist'), album: gv(m, 'xesam:album'), artUrl: gv(m, 'mpris:artUrl'),
    });
  }
  return { players };
}

async function linux() {
  const viaPlayerctl = await linuxPlayerctl();
  if (viaPlayerctl) return { players: viaPlayerctl, hint: null };
  const g = await linuxGdbus();
  if (g.missing) return { players: [], hint: 'Weder „playerctl“ noch „gdbus“ gefunden – bitte „playerctl“ installieren (z. B. sudo apt install playerctl).' };
  if (g.noBus) {
    return {
      players: [],
      hint: process.env.DBUS_SESSION_BUS_ADDRESS ? 'Keine Verbindung zur Desktop-Sitzung (D-Bus).'
        : 'Der Server läuft nicht in der Desktop-Sitzung – bitte im Terminal des angemeldeten Desktops starten.',
    };
  }
  return { players: g.players, hint: null };
}

/* ======================= macOS ======================= */
const isRunning = async (name) => typeof (await run('pgrep', ['-x', name])) === 'string';
const MAC_APPS = {
  Spotify: `tell application "Spotify"
  set t to current track
  return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & (artwork url of t)
end tell`,
  Music: `tell application "Music"
  set t to current track
  return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & ""
end tell`,
};
const MUSIC_SITES = ['open.spotify.com', 'music.youtube.com', 'soundcloud.com', 'deezer.com', 'tidal.com', 'music.apple.com'];
const tabScript = (app, titleProp) => `tell application "${app}"
  set out to ""
  try
    repeat with w in windows
      repeat with t in tabs of w
        set u to URL of t
        if ${MUSIC_SITES.map((s) => `u contains "${s}"`).join(' or ')} then set out to out & u & tab & (${titleProp} of t) & linefeed
      end repeat
    end repeat
  end try
  return out
end tell`;
const BROWSERS = [['Google Chrome', 'Chrome', 'title'], ['Brave Browser', 'Brave', 'title'], ['Microsoft Edge', 'Edge', 'title'],
  ['Arc', 'Arc', 'title'], ['Vivaldi', 'Vivaldi', 'title'], ['Safari', 'Safari', 'name']];

/** Tab-Titel eines Web-Players in Titel/Interpret zerlegen. Pausiert/leer → null. */
function parseTabTitle(url, title) {
  let t = String(title || '').trim();
  if (!t) return null;
  if (url.includes('open.spotify.com')) {
    // spielt: „Titel • Interpret“; pausiert: „Spotify – Web Player“ o. Ä.
    const m = t.split(/\s+•\s+/);
    return m.length >= 2 ? { title: m[0], artist: m.slice(1).join(', ') } : null;
  }
  t = t.replace(/\s*[-–|]\s*(YouTube Music|YouTube|SoundCloud|Deezer|TIDAL|Apple Music)\s*$/i, '').replace(/^\(\d+\)\s*/, '').trim();
  if (!t || /^(YouTube Music|YouTube|SoundCloud|Deezer|TIDAL|Apple Music|Home|Startseite|Discover)$/i.test(t)) return null;
  const parts = t.split(/\s+[-–•|]\s+|\s+by\s+/);
  return parts.length >= 2 ? { title: parts[0], artist: parts.slice(1).join(' – ') } : { title: t, artist: '' };
}

async function mac() {
  const players = [];
  for (const [proc, script] of Object.entries(MAC_APPS)) {
    if (!(await isRunning(proc))) continue;
    const out = text(await run('osascript', ['-e', script]));
    if (!out) continue;
    const [state, title, artist, album, art] = out.replace(/\n$/, '').split('\t');
    if (title) players.push({ name: proc === 'Music' ? 'Apple Music' : 'Spotify', app: proc, playing: /playing/i.test(state), title, artist: artist || '', album: album || '', artUrl: art || '' });
  }
  // „nowplaying-cli“ (Homebrew) kennt alles, was macOS unter „Jetzt läuft“ zeigt – auch Browser
  const np = await run('nowplaying-cli', ['get', 'title', 'artist', 'album', 'playbackRate'], 3000);
  if (typeof np === 'string') {
    const [title, artist, album, rate] = np.split('\n').map((l) => (l.trim() === 'null' ? '' : l.trim()));
    if (title) players.push({ name: 'macOS „Jetzt läuft“', playing: Number(rate) > 0, title, artist, album, artUrl: '' });
  }
  for (const [proc, name, prop] of BROWSERS) {
    if (!(await isRunning(proc))) continue;
    const out = text(await run('osascript', ['-e', tabScript(proc, prop)]));
    if (!out) continue;
    for (const line of out.split('\n').filter(Boolean)) {
      const [url, title] = line.split('\t');
      const p = parseTabTitle(url, title);
      if (p) players.push({ name: `${name} (${MUSIC_SITES.find((s) => url.includes(s)) || 'Web'})`, playing: true, ...p, album: '', artUrl: '' });
    }
  }
  return { players, hint: null };
}

/* ======================= Windows ======================= */
const WIN_PS = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
foreach ($s in $mgr.GetSessions()) {
  $p = $s.GetPlaybackInfo()
  $m = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  "$($p.PlaybackStatus)\`t$($s.SourceAppUserModelId)\`t$($m.Title)\`t$($m.Artist)\`t$($m.AlbumTitle)"
}`;
async function windows() {
  const out = text(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS], 8000));
  if (out === null) return { players: [], hint: 'Windows-Medien-Sitzungen konnten nicht gelesen werden.' };
  return {
    players: out.split(/\r?\n/).filter(Boolean).map((line) => {
      const [st, appId, title, artist, album] = line.split('\t');
      const name = /spotify/i.test(appId) ? 'Spotify' : /chrome/i.test(appId) ? 'Chrome' : /edge/i.test(appId) ? 'Edge' : /firefox/i.test(appId) ? 'Firefox' : (appId || 'Windows').split(/[!.\\]/)[0];
      return { name, playing: /playing/i.test(st), title: title || '', artist: artist || '', album: album || '', artUrl: '' };
    }).filter((p) => p.title),
    hint: null,
  };
}

async function systemPlayers() {
  if (process.platform === 'linux') return linux();
  if (process.platform === 'darwin') return mac();
  if (process.platform === 'win32') return windows();
  return { players: [], hint: 'Dieses Betriebssystem wird nicht unterstützt.' };
}

/** Cover aus einer lokalen Datei (Chrome/Firefox unter Linux legen es in /tmp bzw. im Profil ab). */
function readLocalArt(url, max) {
  try {
    const file = decodeURIComponent(new URL(url).pathname);
    const okDir = [os.tmpdir(), '/tmp', '/var/tmp', os.homedir()].some((d) => file.startsWith(d + '/'));
    if (!okDir) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(file);
  } catch { return null; }
}

module.exports = { systemPlayers, readLocalArt, parseTabTitle, gv };
