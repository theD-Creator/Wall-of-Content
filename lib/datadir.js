'use strict';
/**
 * Wo liegen die Daten (Uploads, Benutzer, Passwörter, Einstellungen, eigene Rahmen/Hintergründe)?
 *
 * Seit dieser Version NICHT mehr im Programmordner, sondern in einem eigenen Ordner:
 *   ~/Wall of Content Daten        (änderbar mit DATA_DIR=/pfad)
 * Dadurch findet jede neu heruntergeladene Version die Daten automatisch wieder.
 *
 * Beim ersten Start ohne Daten in diesem Ordner sucht die App nach alten Daten und übernimmt den neuesten
 * Stand (Kopie, das Original bleibt unangetastet):
 *   1. data/ im eigenen Programmordner (ältere Versionen, „Paket teilen“)
 *   2. ältere Wall-of-Content-Ordner daneben, in Downloads, Schreibtisch, Dokumente …
 * Eigene Dateien aus dem alten assets/-Ordner (hochgeladene Rahmen, Hintergründe, Logo, Profilbilder)
 * kommen nach <Daten>/assets.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_NAME = 'Wall of Content Daten';
const ASSET_SUBDIRS = ['frames', 'backgrounds', 'media', 'avatars'];
const SKIP_DIRS = new Set(['node_modules', 'Library', 'AppData', 'Applications', 'Programme', 'Program Files', 'snap', 'proc', 'sys']);

const hasDb = (dir) => { try { return fs.statSync(path.join(dir, 'db.json')).isFile(); } catch { return false; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const same = (a, b) => {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch { return false; }
};

/** Ältere Installationen finden (Ordner mit server.js und data/db.json). Begrenzt, damit der Start schnell bleibt. */
function findOldInstalls(root, home) {
  const starts = [...new Set([
    path.dirname(root),
    ...['Downloads', 'Desktop', 'Schreibtisch', 'Documents', 'Dokumente'].map((d) => path.join(home, d)),
    home,
  ])];
  const found = [];
  const seen = new Set();
  const deadline = Date.now() + 4000;
  let rootReal = root;
  try { rootReal = fs.realpathSync(root); } catch { /* egal */ }
  let budget = 6000;
  const queue = starts.map((d) => [d, 0]);
  while (queue.length && budget-- > 0 && Date.now() < deadline) {
    const [dir, depth] = queue.shift();
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    if (real !== rootReal && hasDb(path.join(real, 'data')) && fs.existsSync(path.join(real, 'server.js'))) {
      found.push({ root: real, data: path.join(real, 'data'), at: mtime(path.join(real, 'data', 'db.json')) });
      continue;
    }
    if (depth >= 4) continue;
    let list;
    try { list = fs.readdirSync(real, { withFileTypes: true }); } catch { continue; }
    for (const d of list) {
      if (!d.isDirectory() || d.name.startsWith('.') || SKIP_DIRS.has(d.name)) continue;
      queue.push([path.join(real, d.name), depth + 1]);
    }
  }
  return found.sort((a, b) => b.at - a.at);
}

/**
 * Kopiert einen alten Datenstand nach `dest`:
 *  - den Inhalt des alten data/-Ordners (ohne Zwischenstände)
 *  - eigene Dateien aus <alteVersion>/assets, die es in der neuen Version nicht (oder anders) gibt
 */
function copyInstall({ data, root: oldRoot }, dest, newRoot) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(data)) {
    if (name.startsWith('.restore') || name.startsWith('.vorher') || name === 'UMGEZOGEN.txt') continue;
    fs.cpSync(path.join(data, name), path.join(dest, name), { recursive: true, force: true, preserveTimestamps: true });
  }
  if (!oldRoot) return;
  const oldAssets = path.join(oldRoot, 'assets');
  const newAssets = path.join(newRoot, 'assets');
  const copyIfOwn = (rel) => {
    const from = path.join(oldAssets, rel);
    const builtIn = path.join(newAssets, rel);
    if (fs.existsSync(builtIn) && same(from, builtIn)) return;
    const to = path.join(dest, 'assets', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  for (const sub of ASSET_SUBDIRS) {
    let files = [];
    try { files = fs.readdirSync(path.join(oldAssets, sub)); } catch { continue; }
    for (const f of files) {
      if (f.startsWith('.')) continue;
      try { if (fs.statSync(path.join(oldAssets, sub, f)).isFile()) copyIfOwn(path.join(sub, f)); } catch { /* weg */ }
    }
  }
  for (const ext of ['.svg', '.png', '.webp']) if (fs.existsSync(path.join(oldAssets, 'logo' + ext))) copyIfOwn('logo' + ext);
}

function note(dir, text) {
  try { fs.writeFileSync(path.join(dir, 'UMGEZOGEN.txt'), text); } catch { /* schreibgeschützt – egal */ }
}

/** Datenordner bestimmen und bei Bedarf alte Daten übernehmen. Gibt { dir, migrated, hint } zurück. */
function resolveDataDir(root) {
  if (process.env.DATA_DIR) return { dir: path.resolve(process.env.DATA_DIR), migrated: null, hint: null };
  const home = os.homedir();
  const dir = path.join(home, DEFAULT_NAME);
  const local = path.join(root, 'data');
  if (hasDb(dir)) {
    // Daten sind schon umgezogen. Liegt im Programmordner ein neuerer, noch nicht übernommener Stand (z. B. aus
    // „Paket teilen“)? Dann nicht still überschreiben, sondern darauf hinweisen.
    const hint = hasDb(local) && !fs.existsSync(path.join(local, 'UMGEZOGEN.txt')) && mtime(path.join(local, 'db.json')) > mtime(path.join(dir, 'db.json'))
      ? local : null;
    return { dir, migrated: null, hint };
  }
  let source = hasDb(local) ? { root, data: local } : null;
  if (!source) source = findOldInstalls(root, home)[0] || null;
  if (!source) {
    fs.mkdirSync(dir, { recursive: true });
    return { dir, migrated: null, hint: null };
  }
  try {
    copyInstall(source, dir, root);
    note(source.data, `Diese Daten wurden am ${new Date().toLocaleString('de-DE')} nach\n  ${dir}\nübernommen.\n` +
      'Die Wall of Content benutzt ab jetzt diesen Ordner – auch nach jedem Update.\n' +
      'Dieser alte Ordner kann gelöscht werden, sobald alles läuft.\n');
    fs.writeFileSync(path.join(dir, 'migration.json'), JSON.stringify({ from: source.data, at: Date.now() }, null, 2));
    return { dir, migrated: source.data, hint: null };
  } catch (e) {
    console.error('Alte Daten konnten nicht übernommen werden:', e.message);
    return { dir, migrated: null, hint: source.data };
  }
}

module.exports = { resolveDataDir, copyInstall, findOldInstalls, hasDb, ASSET_SUBDIRS };
