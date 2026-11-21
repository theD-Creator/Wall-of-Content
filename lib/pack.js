'use strict';
/**
 * Paket teilen: Die komplette Wall of Content als ZIP – App, Inhalte, Fotos, Einstellungen, Benutzer,
 * Color Hunt, Quiz und Besucher-App. Entpacken, Start-Mac.command doppelklicken, alles ist drin.
 *
 * Sicherheit:
 *  - Passwörter der Admin-Benutzer liegen nur als scrypt-Hash in db.json (wie bisher) – sie funktionieren
 *    beim Empfänger genauso, lassen sich aus dem Ordner aber nicht auslesen.
 *  - NICHT im Paket: admin-password.txt (Startpasswort im Klartext), der private HTTPS-Schlüssel samt
 *    Zertifikat (wird auf dem neuen Rechner neu erzeugt), Sitzungen (nur im Speicher).
 *  - Die „öffentliche Adresse für QR-Codes“ wird geleert, weil sie zum alten Netzwerk gehört.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ZipWriter } = require('./zip');

const TOP = 'Wall-of-Content';
const ROOT_FILES = ['server.js', 'package.json', 'package-lock.json', 'README.md', 'Start-Mac.command', '.gitignore'];
const SKIP = new Set(['.DS_Store', '.git', 'Thumbs.db']);
const GUEST_PHOTO = /^(photo|hunt)-/;

async function walk(dir, rel, out) {
  let list;
  try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    if (SKIP.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) await walk(abs, r, out);
    else if (d.isFile()) out.push({ name: r, file: abs }); // Symlinks (z. B. node_modules/.bin) werden nicht gebraucht
  }
  return out;
}

module.exports = function pack(ctx) {
  const { app, requireGlobal, getDb, ROOT, DATA, UPLOADS, ASSETS, startPasswordActive, globalAdminName } = ctx;
  let running = false;

  /** Aufbereitete Kopie der Datenbank für das Paket. */
  function snapshot(photos) {
    const d = JSON.parse(JSON.stringify(getDb()));
    d.settings.publicUrl = '';
    if (!photos) {
      d.items = d.items.filter((i) => i.kind !== 'photo');
      for (const p of d.hunt.players || []) p.photos = p.photos.map(() => null);
      d.hunt.winnerId = null;
      d.hunt.showWinner = false;
    }
    return Buffer.from(JSON.stringify(d, null, 2));
  }

  async function collect({ photos, node }) {
    const files = [];
    for (const f of ROOT_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push({ name: f, file: path.join(ROOT, f) });
    for (const dir of ['lib', 'public', 'docs', 'node_modules']) await walk(path.join(ROOT, dir), dir, files);
    await walk(ASSETS, 'assets', files);
    const uploads = await walk(UPLOADS, 'data/uploads', []);
    for (const u of uploads) if (photos || !GUEST_PHOTO.test(path.basename(u.name))) files.push(u);
    const nodeBin = path.join(ROOT, '.runtime', 'node', 'bin', 'node');
    if (node && fs.existsSync(nodeBin)) {
      files.push({ name: '.runtime/node/bin/node', file: nodeBin });
      const lic = path.join(ROOT, '.runtime', 'node', 'LICENSE');
      if (fs.existsSync(lic)) files.push({ name: '.runtime/node/LICENSE', file: lic });
    }
    return files;
  }
  const sizeOf = async (list) => {
    let n = 0;
    for (const f of list) { try { n += (await fsp.stat(f.file)).size; } catch { /* weg */ } }
    return n;
  };

  // Vorschau: was kommt mit, wie groß wird es, worauf muss man achten
  app.get('/api/admin/package/info', requireGlobal, async (_req, res) => {
    const all = await collect({ photos: true, node: true });
    const group = (re) => all.filter((f) => re.test(f.name));
    const db = getDb();
    res.json({
      sizes: {
        app: await sizeOf(all.filter((f) => !/^(data\/|\.runtime\/|assets\/)/.test(f.name))),
        assets: await sizeOf(group(/^assets\//)),
        content: await sizeOf(group(/^data\/uploads\//).filter((f) => !GUEST_PHOTO.test(path.basename(f.name)))),
        photos: await sizeOf(group(/^data\/uploads\//).filter((f) => GUEST_PHOTO.test(path.basename(f.name)))),
        node: await sizeOf(group(/^\.runtime\//)),
      },
      counts: {
        items: db.items.filter((i) => i.kind !== 'photo').length,
        photos: db.items.filter((i) => i.kind === 'photo').length,
        users: db.users.length,
        usersWithoutPassword: db.users.filter((u) => !u.pass).map((u) => u.name),
      },
      startPassword: startPasswordActive(),
      globalAdmin: globalAdminName(),
      hasNode: fs.existsSync(path.join(ROOT, '.runtime', 'node', 'bin', 'node')),
    });
  });

  app.get('/api/admin/package.zip', requireGlobal, async (req, res) => {
    if (running) return res.status(409).json({ error: 'Es wird gerade schon ein Paket erstellt – bitte kurz warten.' });
    running = true;
    const photos = req.query.photos !== '0';
    const node = req.query.node !== '0';
    try {
      const files = await collect({ photos, node });
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${TOP}-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      });
      const zip = new ZipWriter(res);
      await zip.addBuffer(`${TOP}/data/db.json`, snapshot(photos), { mode: 0o600 });
      await zip.addBuffer(`${TOP}/data/LIES-MICH.txt`, Buffer.from(
        'Dieses Paket wurde mit „Paket teilen“ im Admin-Panel erstellt.\n\n' +
        'Starten: Ordner „Wall-of-Content“ öffnen und Start-Mac.command doppelklicken.\n' +
        'Anmelden: im Admin-Panel mit denselben Benutzern und Passwörtern wie auf dem Original-Rechner.\n' +
        'Passwörter liegen nur als sicherer Hash (scrypt) in db.json, nie im Klartext.\n' +
        'Das HTTPS-Zertifikat für die Fotostation wird beim ersten Start neu erzeugt.\n'));
      for (const f of files) await zip.addFile(`${TOP}/${f.name}`, f.file);
      await zip.finish();
      res.end();
    } catch (e) {
      if (e.message !== 'Verbindung abgebrochen') console.error('Paket teilen:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Paket konnte nicht erstellt werden' });
      else res.destroy(e);
    } finally {
      running = false;
    }
  });
};
