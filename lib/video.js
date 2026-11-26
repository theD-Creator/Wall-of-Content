'use strict';
/**
 * Videos für die Wall aufbereiten:
 *   - Seitenverhältnis erkennen (auch hochkant gedrehte Handy-Videos), damit die Kachel das richtige Format hat
 *   - schnell ladbare Fassung erzeugen: mit ffmpeg (falls installiert) als H.264-MP4 mit max. 1920 px und
 *     „faststart“; ohne ffmpeg wird bei MP4/MOV zumindest der Index (moov) an den Anfang gelegt,
 *     damit das Video sofort startet, statt erst das Dateiende zu laden.
 */
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');

const run = (cmd, args, timeout) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }));
});
let hasFfmpeg = null;
async function ffmpegAvailable() {
  if (hasFfmpeg === null) hasFfmpeg = (await run('ffmpeg', ['-version'], 5000)).ok && (await run('ffprobe', ['-version'], 5000)).ok;
  return hasFfmpeg;
}

/* ---------- MP4/MOV-Boxen lesen ---------- */
async function topBoxes(fh, size) {
  const boxes = [];
  const head = Buffer.alloc(16);
  let pos = 0;
  while (pos + 8 <= size) {
    await fh.read(head, 0, 16, pos);
    let len = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    let hdr = 8;
    if (len === 1) { len = Number(head.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = size - pos;
    if (len < hdr || pos + len > size) break;
    boxes.push({ type, pos, len, hdr });
    pos += len;
  }
  return boxes;
}
function children(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (len === 1) { len = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (len === 0) len = end - p;
    if (len < hdr || p + len > end) break;
    out.push({ type, start: p, hdr, end: p + len });
    p += len;
  }
  return out;
}
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
function walk(buf, start, end, fn) {
  for (const b of children(buf, start, end)) {
    fn(b);
    if (CONTAINERS.has(b.type)) walk(buf, b.start + b.hdr, b.end, fn);
  }
}

/** Seitenverhältnis aus dem moov-Block (Breite/Höhe der Videospur, Drehung berücksichtigt). */
function ratioFromMoov(moov) {
  let ratio = null;
  for (const trak of children(moov, 8, moov.length).filter((b) => b.type === 'trak')) {
    let tkhd = null; let video = false;
    walk(moov, trak.start + trak.hdr, trak.end, (b) => {
      if (b.type === 'tkhd') tkhd = b;
      if (b.type === 'hdlr' && moov.toString('latin1', b.start + 16, b.start + 20) === 'vide') video = true;
    });
    if (!video || !tkhd) continue;
    const p = tkhd.start + tkhd.hdr;
    const v1 = moov[p] === 1;
    const m = p + (v1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 8; // Matrix
    const a = moov.readInt32BE(m), b = moov.readInt32BE(m + 4);
    let w = moov.readUInt32BE(m + 36) / 65536, h = moov.readUInt32BE(m + 40) / 65536;
    if (a === 0 && b !== 0) [w, h] = [h, w]; // 90°/270° gedreht (Handy hochkant)
    if (w > 0 && h > 0) { ratio = w / h; break; }
  }
  return ratio;
}

async function readMoov(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const boxes = await topBoxes(fh, size);
    const moov = boxes.find((b) => b.type === 'moov');
    if (!moov || moov.len > 200 * 1024 * 1024) return null;
    const buf = Buffer.alloc(moov.len);
    await fh.read(buf, 0, moov.len, moov.pos);
    return { buf, boxes, size };
  } finally { await fh.close(); }
}

const clampRatio = (r) => (r && Number.isFinite(r) ? Math.min(4, Math.max(0.25, Math.round(r * 1000) / 1000)) : null);

/** Seitenverhältnis eines Videos (ffprobe, sonst aus dem MP4-Index). */
async function videoRatio(file) {
  if (await ffmpegAvailable()) {
    const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:stream_tags=rotate', '-of', 'json', file], 20000);
    try {
      const s = JSON.parse(r.out).streams[0];
      let w = s.width, h = s.height;
      const rot = Math.abs(Number((s.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? (s.tags && s.tags.rotate) ?? 0)) % 180;
      if (rot === 90) [w, h] = [h, w];
      if (w > 0 && h > 0) return clampRatio(w / h);
    } catch { /* weiter unten */ }
  }
  try { const m = await readMoov(file); return m ? clampRatio(ratioFromMoov(m.buf)) : null; } catch { return null; }
}

/** Ohne ffmpeg: moov vor mdat legen (wie qt-faststart). Gibt true zurück, wenn dst geschrieben wurde. */
async function faststart(src, dst) {
  const m = await readMoov(src);
  if (!m) return false;
  const moovBox = m.boxes.find((b) => b.type === 'moov');
  const mdat = m.boxes.find((b) => b.type === 'mdat');
  if (!mdat || moovBox.pos < mdat.pos) return false; // schon richtig
  const moov = m.buf;
  const shift = moov.length;
  let ok = true;
  walk(moov, 8, moov.length, (b) => {
    const p = b.start + b.hdr;
    if (b.type === 'stco') {
      const n = moov.readUInt32BE(p + 4);
      for (let i = 0; i < n; i++) {
        const v = moov.readUInt32BE(p + 8 + i * 4) + shift;
        if (v > 0xffffffff) { ok = false; return; }
        moov.writeUInt32BE(v, p + 8 + i * 4);
      }
    } else if (b.type === 'co64') {
      const n = moov.readUInt32BE(p + 4);
      for (let i = 0; i < n; i++) moov.writeBigUInt64BE(moov.readBigUInt64BE(p + 8 + i * 8) + BigInt(shift), p + 8 + i * 8);
    }
  });
  if (!ok) return false;
  const out = fs.createWriteStream(dst);
  const copy = (start, end) => new Promise((resolve, reject) => {
    if (end <= start) return resolve();
    const rs = fs.createReadStream(src, { start, end: end - 1 });
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(out, { end: false });
  });
  await copy(0, mdat.pos);
  await new Promise((r) => out.write(moov, r));
  await copy(mdat.pos, moovBox.pos);
  await copy(moovBox.pos + moovBox.len, m.size);
  await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
  return true;
}

/** Schnell ladbare Fassung von src nach dst (MP4). true = erstellt. */
async function webVersion(src, dst) {
  if (await ffmpegAvailable()) {
    const scale = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'";
    const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', dst], 30 * 60_000);
    if (r.ok) return true;
    await fsp.rm(dst, { force: true });
  }
  if (/\.(mp4|mov|m4v)$/i.test(src)) {
    try { if (await faststart(src, dst)) return true; } catch { /* Original nehmen */ }
    await fsp.rm(dst, { force: true });
  }
  return false;
}

/** Breite/Höhe eines JPEGs (für Vorschaubilder). */
function jpegRatio(buf) {
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const marker = buf[p + 1];
    const len = buf.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const h = buf.readUInt16BE(p + 5), w = buf.readUInt16BE(p + 7);
      return w && h ? clampRatio(w / h) : null;
    }
    p += 2 + len;
  }
  return null;
}

module.exports = { videoRatio, webVersion, jpegRatio, faststart, ffmpegAvailable, ratioFromMoov };
