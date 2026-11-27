'use strict';
/**
 * Kleiner RTMP-Empfänger für OBS (ohne Zusatzpakete): OBS streamt an rtmp://<laptop>:1935/live mit Stream-Key,
 * die Wall holt das Bild als HTTP-FLV ab (Wiedergabe im Browser mit mpegts.js).
 *
 * Unterstützt, was OBS beim Streamen schickt: einfacher Handshake, Chunk-Stream, AMF0-Befehle
 * (connect, releaseStream, FCPublish, createStream, publish, FCUnpublish, deleteStream), Metadaten,
 * H.264-Video und AAC-Audio. Es darf immer nur ein Stream gleichzeitig senden; der Stream-Key wird geprüft.
 * Für einen schnellen Start bekommen neue Zuschauer Metadaten, Decoder-Konfiguration und die letzte GOP
 * (ab dem letzten Keyframe) sofort mitgeschickt.
 */
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/* ---------------- AMF0 ---------------- */
function amfDecode(buf) {
  const out = [];
  let p = 0;
  const str = () => { const n = buf.readUInt16BE(p); p += 2; const s = buf.toString('utf8', p, p + n); p += n; return s; };
  function value() {
    const t = buf[p++];
    switch (t) {
      case 0x00: { const v = buf.readDoubleBE(p); p += 8; return v; }
      case 0x01: return buf[p++] !== 0;
      case 0x02: return str();
      case 0x03: case 0x08: {
        if (t === 0x08) p += 4; // ECMA-Array: Anzahl ignorieren
        const o = {};
        while (p < buf.length) {
          if (buf.readUInt16BE(p) === 0 && buf[p + 2] === 0x09) { p += 3; break; }
          const k = str();
          o[k] = value();
        }
        return o;
      }
      case 0x05: case 0x06: return null;
      case 0x0a: { const n = buf.readUInt32BE(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(value()); return a; }
      case 0x0b: { const v = buf.readDoubleBE(p); p += 10; return new Date(v); }
      case 0x0c: { const n = buf.readUInt32BE(p); p += 4; const s = buf.toString('utf8', p, p + n); p += n; return s; }
      default: throw new Error('AMF0-Typ ' + t);
    }
  }
  try { while (p < buf.length) out.push(value()); } catch { /* Rest ignorieren */ }
  return out;
}
function amfEncode(...vals) {
  const parts = [];
  const str = (s) => { const b = Buffer.from(s, 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); return Buffer.concat([h, b]); };
  function enc(v) {
    if (v === null || v === undefined) return Buffer.from([0x05]);
    if (typeof v === 'number') { const b = Buffer.alloc(9); b[0] = 0; b.writeDoubleBE(v, 1); return b; }
    if (typeof v === 'boolean') return Buffer.from([0x01, v ? 1 : 0]);
    if (typeof v === 'string') return Buffer.concat([Buffer.from([0x02]), str(v)]);
    const o = [Buffer.from([0x03])];
    for (const [k, x] of Object.entries(v)) o.push(str(k), enc(x));
    o.push(Buffer.from([0, 0, 0x09]));
    return Buffer.concat(o);
  }
  for (const v of vals) parts.push(enc(v));
  return Buffer.concat(parts);
}

/* ---------------- FLV ---------------- */
function flvTag(type, ts, data) {
  const h = Buffer.alloc(11);
  h[0] = type;
  h.writeUIntBE(data.length, 1, 3);
  h.writeUIntBE(ts & 0xffffff, 4, 3);
  h[7] = (ts >>> 24) & 0xff;
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(11 + data.length);
  return Buffer.concat([h, data, tail]);
}
const FLV_HEADER = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 0x09, 0, 0, 0, 0]);

/* ---------------- Server ---------------- */
class RtmpServer extends EventEmitter {
  constructor({ port = 1935, checkKey }) {
    super();
    this.port = port;
    this.checkKey = checkKey;
    this.publisher = null; // aktive Sitzung
    this.viewers = new Set();
    this.resetStream();
  }

  resetStream() {
    this.meta = null; this.avcHeader = null; this.aacHeader = null; this.gop = []; this.info = null; this.since = null;
  }

  get live() { return !!(this.publisher && this.since); }

  listen() {
    this.server = net.createServer((sock) => this.session(sock));
    this.server.on('error', (e) => this.emit('error', e));
    this.server.listen(this.port, () => this.emit('listening', this.port));
    return this;
  }

  /** Einen Zuschauer (HTTP-Antwort) anhängen: FLV-Kopf, Konfiguration, letzte GOP, dann live. */
  addViewer(res) {
    res.write(FLV_HEADER);
    const base = this.gop.length ? this.gop[0].ts : 0;
    if (this.meta) res.write(flvTag(18, 0, this.meta));
    if (this.avcHeader) res.write(flvTag(9, 0, this.avcHeader));
    if (this.aacHeader) res.write(flvTag(8, 0, this.aacHeader));
    for (const t of this.gop) res.write(flvTag(t.type, Math.max(0, t.ts - base), t.data));
    const viewer = { res, base };
    this.viewers.add(viewer);
    res.on('close', () => this.viewers.delete(viewer));
  }

  forward(type, ts, data) {
    for (const v of this.viewers) {
      if (v.res.writableLength > 16 * 1024 * 1024) { v.res.destroy(); this.viewers.delete(v); continue; } // hängt hinterher
      v.res.write(flvTag(type, Math.max(0, ts - v.base), data));
    }
  }

  /** Metadaten/Decoder-Konfiguration auch an Zuschauer schicken, die schon vor dem Start verbunden waren. */
  forwardConfig(type, data) {
    for (const v of this.viewers) v.res.write(flvTag(type, 0, data));
  }

  endStream(reason) {
    if (!this.since) return;
    this.resetStream();
    for (const v of this.viewers) v.res.end();
    this.viewers.clear();
    this.emit('change', { live: false, reason });
  }

  session(sock) {
    sock.setNoDelay(true);
    const id = crypto.randomBytes(4).toString('hex');
    let buf = Buffer.alloc(0);
    let stage = 0; // 0 = warte auf C0+C1, 1 = warte auf C2, 2 = Chunks
    let inChunk = 128;
    let outChunk = 128;
    const streams = new Map(); // csid -> Zustand
    let received = 0, acked = 0, ackWindow = 2_500_000;
    let publishing = false;

    const sendMessage = (csid, type, streamId, payload, ts = 0) => {
      const chunks = [];
      for (let off = 0, first = true; off < payload.length || first; off += outChunk, first = false) {
        let head;
        if (first) {
          head = Buffer.alloc(12);
          head[0] = csid & 0x3f;
          head.writeUIntBE(Math.min(ts, 0xffffff), 1, 3);
          head.writeUIntBE(payload.length, 4, 3);
          head[7] = type;
          head.writeUInt32LE(streamId, 8);
        } else {
          head = Buffer.from([0xc0 | (csid & 0x3f)]);
        }
        chunks.push(head, payload.subarray(off, off + outChunk));
      }
      if (!sock.destroyed) sock.write(Buffer.concat(chunks));
    };
    const control = (type, value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); sendMessage(2, type, 0, b); };
    const command = (streamId, ...vals) => sendMessage(streamId ? 5 : 3, 20, streamId, amfEncode(...vals));
    const status = (code, level, description) => command(1, 'onStatus', 0, null, { level, code, description });

    const fail = (msg) => { this.emit('log', `RTMP ${id}: ${msg}`); sock.destroy(); };

    const onCommand = (streamId, args) => {
      const [name, txid] = args;
      if (name === 'connect') {
        const app = String((args[2] && args[2].app) || '').replace(/\/$/, '');
        control(5, 2_500_000);                                // Window Acknowledgement Size
        const bw = Buffer.alloc(5); bw.writeUInt32BE(2_500_000); bw[4] = 2; sendMessage(2, 6, 0, bw); // Set Peer Bandwidth
        control(1, 4096); outChunk = 4096;                    // Set Chunk Size
        if (app !== 'live') {
          command(0, '_error', txid, null, { level: 'error', code: 'NetConnection.Connect.Rejected', description: 'Server-Adresse muss auf /live enden' });
          return fail(`App „${app}“ abgelehnt`);
        }
        command(0, '_result', txid, { fmsVer: 'FMS/3,5,7,7009', capabilities: 31 },
          { level: 'status', code: 'NetConnection.Connect.Success', description: 'Verbunden mit der Wall of Content', objectEncoding: 0 });
      } else if (name === 'createStream') {
        command(0, '_result', txid, null, 1);
      } else if (name === 'releaseStream' || name === 'FCPublish') {
        if (name === 'FCPublish') command(0, 'onFCPublish', 0, null, { code: 'NetStream.Publish.Start', description: String(args[3] || '') });
        else command(0, '_result', txid, null);
      } else if (name === 'publish') {
        const key = String(args[3] || '').split('?')[0];
        if (!this.checkKey(key)) {
          status('NetStream.Publish.BadName', 'error', 'Falscher Stream-Key');
          return fail('falscher Stream-Key');
        }
        if (this.publisher && this.publisher !== sock) {
          status('NetStream.Publish.BadName', 'error', 'Es streamt schon jemand an die Wall');
          return fail('es streamt schon jemand');
        }
        this.publisher = sock;
        publishing = true;
        this.resetStream();
        this.since = Date.now();
        status('NetStream.Publish.Start', 'status', 'Live auf der Wall of Content');
        this.emit('change', { live: true });
      } else if (name === 'FCUnpublish' || name === 'deleteStream' || name === 'closeStream') {
        if (publishing && this.publisher === sock) { publishing = false; this.publisher = null; this.endStream('beendet'); }
      }
    };

    const onMessage = (type, streamId, ts, payload) => {
      switch (type) {
        case 1: inChunk = payload.readUInt32BE(0) & 0x7fffffff; break;
        case 5: ackWindow = payload.readUInt32BE(0); break;
        case 20: onCommand(streamId, amfDecode(payload)); break;
        case 18: {
          if (!publishing) break;
          const vals = amfDecode(payload);
          if (vals[0] === '@setDataFrame') {
            this.meta = amfEncode(...vals.slice(1));
            this.forwardConfig(18, this.meta);
            const m = vals[2] || {};
            this.info = { width: m.width, height: m.height, fps: m.framerate, videoKbps: m.videodatarate, audioKbps: m.audiodatarate, encoder: m.encoder };
            this.emit('change', { live: true });
          }
          break;
        }
        case 8: case 9: {
          if (!publishing || !payload.length) break;
          if (type === 9) {
            const frame = payload[0] >> 4, codec = payload[0] & 0x0f;
            if (codec === 7 && payload[1] === 0) { this.avcHeader = payload; this.forwardConfig(9, payload); break; }
            if (frame === 1) this.gop = []; // Keyframe: neue GOP beginnen
          } else if ((payload[0] >> 4) === 10 && payload[1] === 0) { this.aacHeader = payload; this.forwardConfig(8, payload); break; }
          if (this.gop.length < 3000) this.gop.push({ type, ts, data: payload });
          this.forward(type, ts, payload);
          break;
        }
        default: break;
      }
    };

    const parse = () => {
      for (;;) {
        if (stage === 0) {
          if (buf.length < 1537) return;
          const c1 = buf.subarray(1, 1537);
          const s1 = Buffer.alloc(1536); crypto.randomFillSync(s1, 8); // Zeit 0, Null-Bytes, Zufall
          sock.write(Buffer.concat([Buffer.from([3]), s1, c1]));
          buf = buf.subarray(1537); stage = 1; continue;
        }
        if (stage === 1) {
          if (buf.length < 1536) return;
          buf = buf.subarray(1536); stage = 2; continue;
        }
        // Chunk lesen
        if (buf.length < 1) return;
        let p = 0;
        const fmt = buf[0] >> 6;
        let csid = buf[0] & 0x3f;
        p = 1;
        if (csid === 0) { if (buf.length < 2) return; csid = 64 + buf[1]; p = 2; } else if (csid === 1) { if (buf.length < 3) return; csid = 64 + buf[1] + buf[2] * 256; p = 3; }
        const st = streams.get(csid) || { ts: 0, delta: 0, len: 0, type: 0, sid: 0, payload: null, got: 0, ext: false };
        const hlen = [11, 7, 3, 0][fmt];
        if (buf.length < p + hlen) return;
        const raw = fmt <= 2 ? buf.readUIntBE(p, 3) : 0;
        let tsField = raw;
        if (fmt <= 1) { st.len = buf.readUIntBE(p + 3, 3); st.type = buf[p + 6]; }
        if (fmt === 0) st.sid = buf.readUInt32LE(p + 7);
        p += hlen;
        const hasExt = fmt <= 2 ? raw === 0xffffff : st.ext;
        if (hasExt) { if (buf.length < p + 4) return; tsField = buf.readUInt32BE(p); p += 4; }
        const starting = !st.payload;
        const n = Math.min(inChunk, st.len - (starting ? 0 : st.got));
        if (buf.length < p + n) return;
        // Kopf erst jetzt übernehmen (Chunk vollständig da)
        if (fmt <= 2) st.ext = raw === 0xffffff;
        if (starting) {
          if (fmt === 0) st.ts = tsField;
          else if (fmt <= 2) { st.delta = tsField; st.ts += tsField; } else st.ts += st.delta;
          st.payload = Buffer.alloc(st.len);
          st.got = 0;
        }
        buf.copy(st.payload, st.got, p, p + n);
        st.got += n;
        buf = buf.subarray(p + n);
        streams.set(csid, st);
        if (st.got >= st.len) {
          const msg = st.payload;
          st.payload = null;
          try { onMessage(st.type, st.sid, st.ts, msg); } catch (e) { this.emit('log', `RTMP ${id}: ${e.message}`); }
        }
      }
    };

    sock.on('data', (d) => {
      received += d.length;
      if (stage === 2 && received - acked >= ackWindow / 2) { acked = received; control(3, received >>> 0); }
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (buf.length > 64 * 1024 * 1024) return fail('zu viele Daten');
      parse();
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      if (publishing && this.publisher === sock) { this.publisher = null; this.endStream('Verbindung getrennt'); }
    });
    sock.setTimeout(30_000, () => sock.destroy());
  }
}

module.exports = { RtmpServer, amfDecode, amfEncode };
