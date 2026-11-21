'use strict';
/**
 * Schreibt ein ZIP-Archiv als Stream (ohne zusätzliche Pakete).
 *  - kleine, gut komprimierbare Dateien: Deflate; Fotos/Videos/Binärdateien: unkomprimiert („stored“)
 *  - CRC und Größen werden vorab berechnet, daher keine „data descriptors“ (macOS-Archivprogramm mag sie nicht)
 *  - ZIP64 automatisch für Dateien/Archive über 4 GB
 *  - Unix-Rechte bleiben erhalten (Start-Mac.command bleibt ausführbar)
 */
const fs = require('fs');
const zlib = require('zlib');
const deflateRaw = require('util').promisify(zlib.deflateRaw); // läuft im Thread-Pool, blockiert die Live-Wall nicht

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf, crc = 0) {
  if (zlib.crc32) return zlib.crc32(buf, crc); // Node ≥ 22.2: native, deutlich schneller
  crc = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}
async function crc32File(file) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) crc = crc32(chunk, crc);
  return crc;
}

const MAX32 = 0xffffffff;
const COMPRESS = /\.(js|json|css|html|md|txt|svg|command|map|ts|cjs|mjs|yml|yaml|lock|license)$|(^|\/)(LICENSE|README|CHANGELOG)[^/]*$|(^|\/)node$/i;

function dosTime(date) {
  const d = new Date(date);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class ZipWriter {
  /** @param {import('stream').Writable} out  @param {{force64?: boolean}} opts */
  constructor(out, opts = {}) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    this.force64 = !!opts.force64;
  }

  write(buf) {
    this.offset += buf.length;
    if (this.out.write(buf)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { this.out.off('drain', done); this.out.off('close', fail); resolve(); };
      const fail = () => { this.out.off('drain', done); reject(new Error('Verbindung abgebrochen')); };
      this.out.once('drain', done);
      this.out.once('close', fail);
    });
  }

  header(e) {
    const name = Buffer.from(e.name, 'utf8');
    const zip64 = this.force64 || e.size >= MAX32 || e.csize >= MAX32;
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(e.size), 4);
      extra.writeBigUInt64LE(BigInt(e.csize), 12);
    }
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(zip64 ? 45 : 20, 4);
    h.writeUInt16LE(0x0800, 6); // Dateinamen in UTF-8
    h.writeUInt16LE(e.method, 8);
    h.writeUInt16LE(e.dos.time, 10);
    h.writeUInt16LE(e.dos.date, 12);
    h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(zip64 ? MAX32 : e.csize, 18);
    h.writeUInt32LE(zip64 ? MAX32 : e.size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(extra.length, 28);
    e.zip64 = zip64;
    return Buffer.concat([h, name, extra]);
  }

  /** Datei aus einem Buffer (z. B. eine aufbereitete db.json). */
  async addBuffer(name, data, { mode = 0o644, mtime = Date.now() } = {}) {
    const deflated = await deflateRaw(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const e = {
      name, mode, dos: dosTime(mtime), crc: crc32(data), size: data.length,
      method: useDeflate ? 8 : 0, csize: useDeflate ? deflated.length : data.length, offset: this.offset,
    };
    await this.write(this.header(e));
    await this.write(useDeflate ? deflated : data);
    this.entries.push(e);
  }

  /** Datei von der Platte; gibt false zurück, wenn sie inzwischen verschwunden ist. */
  async addFile(name, file) {
    let st;
    try { st = await fs.promises.stat(file); } catch { return false; }
    if (!st.isFile()) return false;
    const mode = st.mode & 0o777;
    // kleine Textdateien komprimieren, große/fertig komprimierte Medien direkt übernehmen
    // (bis 160 MB im Speicher komprimieren – das Node.js-Programm schrumpft so auf gut ein Drittel)
    if (st.size < 160 * 1024 * 1024 && COMPRESS.test(name)) {
      let data;
      try { data = await fs.promises.readFile(file); } catch { return false; }
      await this.addBuffer(name, data, { mode, mtime: st.mtimeMs });
      return true;
    }
    let crc;
    try { crc = await crc32File(file); } catch { return false; }
    const e = { name, mode, dos: dosTime(st.mtimeMs), crc, size: st.size, method: 0, csize: st.size, offset: this.offset };
    await this.write(this.header(e));
    let written = 0;
    if (st.size) for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20, end: st.size - 1 })) { // leere Dateien (z. B. .gitkeep): nichts zu lesen
      written += chunk.length;
      await this.write(chunk);
    }
    if (written !== st.size) throw new Error(`${name} hat sich beim Packen verändert`);
    this.entries.push(e);
    return true;
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const name = Buffer.from(e.name, 'utf8');
      const big = this.force64 || e.zip64 || e.offset >= MAX32;
      const vals = [];
      if (big) vals.push(e.size, e.csize, e.offset);
      const extra = Buffer.alloc(vals.length ? 4 + vals.length * 8 : 0);
      if (vals.length) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(vals.length * 8, 2);
        vals.forEach((v, i) => extra.writeBigUInt64LE(BigInt(v), 4 + i * 8));
      }
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE((3 << 8) | 45, 4); // erstellt unter Unix, ZIP 4.5
      c.writeUInt16LE(big ? 45 : 20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.dos.time, 12);
      c.writeUInt16LE(e.dos.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(big ? MAX32 : e.csize, 20);
      c.writeUInt32LE(big ? MAX32 : e.size, 24);
      c.writeUInt16LE(name.length, 28);
      c.writeUInt16LE(extra.length, 30);
      c.writeUInt16LE(0, 32); // Kommentar
      c.writeUInt16LE(0, 34); // Disk
      c.writeUInt16LE(0, 36); // interne Attribute
      c.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38); // Unix-Dateirechte
      c.writeUInt32LE(big ? MAX32 : e.offset, 42);
      await this.write(Buffer.concat([c, name, extra]));
    }
    const cdSize = this.offset - cdStart;
    const n = this.entries.length;
    const need64 = this.force64 || n >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32;
    if (need64) {
      const z = Buffer.alloc(56);
      const z64Start = this.offset;
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE((3 << 8) | 45, 12);
      z.writeUInt16LE(45, 14);
      z.writeUInt32LE(0, 16);
      z.writeUInt32LE(0, 20);
      z.writeBigUInt64LE(BigInt(n), 24);
      z.writeBigUInt64LE(BigInt(n), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(z64Start), 8);
      loc.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([z, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(need64 ? 0xffff : n, 8);
    end.writeUInt16LE(need64 ? 0xffff : n, 10);
    end.writeUInt32LE(need64 ? MAX32 : cdSize, 12);
    end.writeUInt32LE(need64 ? MAX32 : cdStart, 16);
    await this.write(end);
  }
}

module.exports = { ZipWriter, crc32 };
