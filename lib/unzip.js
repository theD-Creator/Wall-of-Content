'use strict';
/**
 * Liest ZIP-Archive (auch ZIP64, auch große Dateien) ohne zusätzliche Pakete und entpackt sie gestreamt.
 * Unterstützt „stored“ und „deflate“ – das, was lib/zip.js, macOS und Windows erzeugen.
 * Pfade mit „..“ oder absolute Pfade werden abgelehnt (Schutz vor Zip-Slip).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}
const u64 = (buf, off) => Number(buf.readBigUInt64LE(off));

/** Inhaltsverzeichnis lesen: [{ name, method, compSize, size, offset, dir }] */
async function list(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557 + 20);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    // ZIP64: Locator direkt vor dem EOCD
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z64 = await readAt(fh, u64(tail, eocd - 20 + 8), 56);
      if (z64.readUInt32LE(0) === 0x06064b50) { count = u64(z64, 32); cdSize = u64(z64, 40); cdOff = u64(z64, 48); }
    }
    const cd = await readAt(fh, cdOff, cdSize);
    const out = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Inhaltsverzeichnis beschädigt');
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      // ZIP64-Zusatzfeld
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(cd, q); q += 8; }
        }
        e += 4 + len;
      }
      out.push({ name, method, compSize, size: usize, offset, dir: name.endsWith('/') });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Sicherer Zielpfad oder null. */
function safeJoin(dest, name) {
  const norm = name.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-z]:/i.test(norm) || norm.split('/').includes('..')) return null;
  const target = path.join(dest, norm);
  return target.startsWith(path.resolve(dest) + path.sep) ? target : null;
}

/**
 * Entpackt alle Einträge unter `prefix` (z. B. "Wall-of-Content-Daten/") nach `dest`.
 * `filter(relName)` kann Einträge auslassen.
 */
async function extract(file, dest, { prefix = '', filter = () => true } = {}) {
  const entries = await list(file);
  const fh = await fsp.open(file, 'r');
  try {
    for (const en of entries) {
      if (en.dir || !en.name.startsWith(prefix)) continue;
      const rel = en.name.slice(prefix.length);
      if (!rel || rel.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(rel) || !filter(rel)) continue;
      const target = safeJoin(dest, rel);
      if (!target) throw new Error('Ungültiger Pfad im Archiv: ' + en.name);
      const head = await readAt(fh, en.offset, 30);
      if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + en.name);
      const start = en.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const raw = en.compSize ? fs.createReadStream(file, { start, end: start + en.compSize - 1 }) : null;
      if (!raw) { await fsp.writeFile(target, ''); continue; }
      if (en.method === 0) await pipeline(raw, fs.createWriteStream(target));
      else if (en.method === 8) await pipeline(raw, zlib.createInflateRaw(), fs.createWriteStream(target));
      else throw new Error('Nicht unterstützte Kompression in ' + en.name);
    }
  } finally {
    await fh.close();
  }
}

module.exports = { list, extract };
