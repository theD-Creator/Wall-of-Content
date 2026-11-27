'use strict';
/**
 * Sicherung & Übernahme (nur Global Admin):
 *   GET  /api/admin/backup/info          – wo liegen die Daten, wie groß, wurde etwas übernommen
 *   GET  /api/admin/backup.zip           – kompletter Datenordner als ZIP (Uploads, Benutzer, Passwort-Hashes, Einstellungen)
 *   POST /api/admin/backup/restore       – ZIP einspielen (Body = ZIP-Datei)
 *   POST /api/admin/backup/import {path} – Daten aus einem alten Wall-of-Content-Ordner auf diesem Rechner übernehmen
 *   GET  /api/admin/backup/old           – alte Installationen auf diesem Rechner suchen
 *
 * Einspielen/Übernehmen legt den neuen Stand in <Daten>/.restore-pending ab und startet den Server neu.
 * Beim Start wird er übernommen; der bisherige Stand landet in <Daten>/.vorher-<Datum> (die zwei neuesten bleiben).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const { ZipWriter } = require('./zip');
const unzip = require('./unzip');
const { copyInstall, findOldInstalls, hasDb } = require('./datadir');
const { RESTART } = require('./supervisor');

const PENDING = '.restore-pending';
const UPLOAD = '.restore-upload.zip';
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

/** Beim Start: wartenden Stand übernehmen. Läuft vor dem Laden der Datenbank. */
function applyPending(DATA) {
  const pending = path.join(DATA, PENDING);
  try { fs.rmSync(path.join(DATA, UPLOAD), { force: true }); } catch { /* egal */ }
  if (!hasDb(pending)) { fs.rmSync(pending, { recursive: true, force: true }); return null; }
  const keep = path.join(DATA, '.vorher-' + stamp());
  fs.mkdirSync(keep, { recursive: true });
  for (const name of fs.readdirSync(DATA)) {
    if (name.startsWith('.restore') || name.startsWith('.vorher')) continue;
    fs.renameSync(path.join(DATA, name), path.join(keep, name));
  }
  for (const name of fs.readdirSync(pending)) fs.renameSync(path.join(pending, name), path.join(DATA, name));
  fs.rmSync(pending, { recursive: true, force: true });
  // nur die zwei neuesten Zwischenstände behalten
  const old = fs.readdirSync(DATA).filter((n) => n.startsWith('.vorher-')).sort().reverse();
  for (const n of old.slice(2)) fs.rmSync(path.join(DATA, n), { recursive: true, force: true });
  console.log(`\n  ✔ Gesicherter Stand übernommen. Der vorherige Stand liegt in ${keep}\n`);
  return keep;
}

async function walk(dir, rel, out) {
  let list;
  try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    if (d.name.startsWith('.') || d.name.endsWith('.tmp')) continue; // Zwischenstände, .DS_Store
    const abs = path.join(dir, d.name);
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) await walk(abs, r, out);
    else if (d.isFile()) out.push({ name: r, file: abs });
  }
  return out;
}

module.exports = function backup(ctx) {
  const { app, requireGlobal, DATA, ROOT, dataInfo, flush, express } = ctx;
  let busy = false;
  const supervised = !!process.env.WOC_CHILD;

  async function restartSoon(res, msg) {
    await flush();
    res.json({ ok: true, restart: supervised, message: supervised ? msg + ' Die App startet jetzt neu …' : msg + ' Bitte den Server jetzt neu starten.' });
    if (supervised) setTimeout(() => process.exit(RESTART), 800);
  }

  app.get('/api/admin/backup/info', requireGlobal, async (_req, res) => {
    const files = await walk(DATA, '', []);
    let size = 0;
    for (const f of files) { try { size += (await fsp.stat(f.file)).size; } catch { /* weg */ } }
    res.json({ dataDir: DATA, size, files: files.length, ...dataInfo(), supervised });
  });

  app.get('/api/admin/backup/old', requireGlobal, (_req, res) => {
    const list = findOldInstalls(ROOT, require('os').homedir()).slice(0, 10)
      .map((f) => ({ path: f.root, at: f.at }));
    res.json({ list });
  });

  app.get('/api/admin/backup.zip', requireGlobal, async (_req, res) => {
    if (busy) return res.status(409).json({ error: 'Es läuft gerade schon eine Sicherung.' });
    busy = true;
    try {
      await flush();
      const files = await walk(DATA, '', []);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Wall-of-Content-Sicherung-${stamp().slice(0, 10)}.zip"`,
        'Cache-Control': 'no-store',
      });
      const zip = new ZipWriter(res);
      for (const f of files) await zip.addFile(`Wall-of-Content-Daten/${f.name}`, f.file);
      await zip.finish();
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'Sicherung fehlgeschlagen' });
      else res.destroy(e);
    } finally {
      busy = false;
    }
  });

  // ZIP einspielen: erst komplett speichern, dann prüfen, dann entpacken
  app.post('/api/admin/backup/restore', requireGlobal, async (req, res) => {
    if (busy) return res.status(409).json({ error: 'Es läuft gerade schon eine Sicherung.' });
    busy = true;
    const zipFile = path.join(DATA, UPLOAD);
    const pending = path.join(DATA, PENDING);
    try {
      await pipeline(req, fs.createWriteStream(zipFile));
      const entries = await unzip.list(zipFile).catch(() => { throw Object.assign(new Error('Das ist keine gültige ZIP-Datei.'), { status: 400 }); });
      // db.json mit dem kürzesten Pfad bestimmt den Datenordner im Archiv (Sicherung, Paket oder alter data-Ordner)
      const dbEntry = entries.filter((e) => /(^|\/)db\.json$/.test(e.name) && !e.name.includes('__MACOSX'))
        .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
      if (!dbEntry) throw Object.assign(new Error('In der ZIP-Datei ist keine Sicherung (db.json fehlt).'), { status: 400 });
      const prefix = dbEntry.name.slice(0, -'db.json'.length);
      await fsp.rm(pending, { recursive: true, force: true });
      await unzip.extract(zipFile, pending, { prefix });
      // Stammt das ZIP aus „Paket teilen“ (…/data/db.json), kommen eigene Dateien aus …/assets mit
      const appPrefix = prefix.endsWith('data/') ? prefix.slice(0, -'data/'.length) : null;
      if (appPrefix !== null && entries.some((e) => e.name === appPrefix + 'server.js')) {
        const tmpApp = path.join(DATA, '.restore-app');
        await fsp.rm(tmpApp, { recursive: true, force: true });
        await unzip.extract(zipFile, path.join(tmpApp, 'assets'), { prefix: appPrefix + 'assets/' });
        copyAssetsOnly(tmpApp, pending, ROOT);
        await fsp.rm(tmpApp, { recursive: true, force: true });
      }
      JSON.parse(await fsp.readFile(path.join(pending, 'db.json'), 'utf8')); // muss lesbar sein
      await fsp.rm(zipFile, { force: true });
      await restartSoon(res, 'Sicherung geprüft.');
    } catch (e) {
      await fsp.rm(pending, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(zipFile, { force: true }).catch(() => {});
      if (e instanceof SyntaxError) return res.status(400).json({ error: 'Die db.json in der Sicherung ist beschädigt.' });
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Einspielen fehlgeschlagen: ' + e.message });
    } finally {
      busy = false;
    }
  });

  app.post('/api/admin/backup/import', requireGlobal, express.json({ limit: '10kb' }), async (req, res) => {
    if (busy) return res.status(409).json({ error: 'Es läuft gerade schon eine Sicherung.' });
    let p = String(req.body?.path || '').trim().replace(/^['"]|['"]$/g, '');
    if (p.startsWith('~')) p = path.join(require('os').homedir(), p.slice(1));
    if (!p || !path.isAbsolute(p)) return res.status(400).json({ error: 'Bitte den vollständigen Pfad zum alten Ordner angeben.' });
    p = path.resolve(p);
    // akzeptiert: Programmordner (mit data/db.json) oder direkt einen Datenordner (mit db.json)
    const source = hasDb(path.join(p, 'data')) ? { root: p, data: path.join(p, 'data') }
      : hasDb(p) ? { root: fs.existsSync(path.join(p, '..', 'server.js')) ? path.dirname(p) : null, data: p } : null;
    if (!source) return res.status(400).json({ error: 'In diesem Ordner wurden keine Wall-of-Content-Daten gefunden (db.json fehlt).' });
    if (path.resolve(source.data) === path.resolve(DATA)) return res.status(400).json({ error: 'Das ist der Ordner, der gerade benutzt wird.' });
    busy = true;
    const pending = path.join(DATA, PENDING);
    try {
      await fsp.rm(pending, { recursive: true, force: true });
      copyInstall(source, pending, ROOT);
      for (const n of ['UMGEZOGEN.txt', 'migration.json']) await fsp.rm(path.join(pending, n), { force: true });
      await restartSoon(res, 'Daten gefunden und kopiert.');
    } catch (e) {
      await fsp.rm(pending, { recursive: true, force: true }).catch(() => {});
      res.status(500).json({ error: 'Übernehmen fehlgeschlagen: ' + e.message });
    } finally {
      busy = false;
    }
  });
};

/** Nur die eigenen Dateien aus einem entpackten Programm-assets-Ordner übernehmen. */
function copyAssetsOnly(appDir, dest, root) {
  const tmpData = path.join(appDir, '.nodata');
  fs.mkdirSync(tmpData, { recursive: true });
  copyInstall({ root: appDir, data: tmpData }, dest, root);
}

module.exports.applyPending = applyPending;
