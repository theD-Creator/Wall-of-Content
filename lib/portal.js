'use strict';
/**
 * Besucher-Bereich der Wall of Content (Seite /app auf den Handys der Gäste):
 *   - Live-Programm (Zeitplan)
 *   - Challenges: QR-Code-Schatzsuche und digitaler Rundgang mit Stempeln
 *   - Merch-Shop: Punkte aus den Challenges gegen Coupons tauschen
 *   - Feedback
 *
 * Alle Daten liegen in db.portal (data/db.json). Jeder Gast bekommt beim ersten Öffnen ein
 * anonymes Besucherprofil (Cookie „woc_visitor“) und einen Besucher-Code, mit dem er seinen
 * Fortschritt auf ein anderes Gerät/einen anderen Browser mitnehmen kann.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I – leicht abzulesen
const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % 32]).join(''); // 256 % 32 = 0 -> gleichverteilt
const newToken = () => crypto.randomBytes(16).toString('base64url'); // Inhalt der QR-Codes (128 Bit, nicht erratbar)
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const VISITOR_MS = 60 * 86400_000;
const MAX_VISITORS = 20000;

module.exports = function installPortal(ctx) {
  const {
    app, express, save, broadcast, requireAdmin, clean, newId, sha, cookies, rateLimit, sameOrigin,
    publicBase, QRCode, escapeHtml, UPLOADS, contentType, page, ROOT, settings, logoUrl,
  } = ctx;

  /* ------------------------------------------------------------------ */
  /* Daten                                                               */
  /* ------------------------------------------------------------------ */
  const p = () => {
    const db = ctx.getDb();
    const d = (db.portal ||= {});
    d.feedback ||= [];
    d.program ||= [];
    d.visitors ||= [];
    d.challenges ||= {};
    d.challenges.qr ||= [{
      id: newId(), title: 'Finde den versteckten QR-Code auf dem Gelände!', hint: '', points: 50, active: true, token: newToken(),
    }];
    d.challenges.stations ||= [];
    d.challenges.done ||= [];
    d.shop ||= {};
    d.shop.items ||= [];
    d.shop.coupons ||= [];
    return d;
  };
  p();

  // Index Token-Hash -> Besucher (schnelles Wiedererkennen)
  const tokenIndex = new Map();
  const reindex = () => {
    tokenIndex.clear();
    for (const v of p().visitors) for (const h of v.tokens) tokenIndex.set(h, v);
  };
  reindex();

  const changed = (type, roles = ['admin', 'visitor']) => { save(); broadcast(type, {}, roles); };
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  const nextOrder = (list) => list.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;

  /* ------------------------------------------------------------------ */
  /* Besucher                                                            */
  /* ------------------------------------------------------------------ */
  function visitorFrom(req) {
    const token = cookies(req).woc_visitor;
    return token ? tokenIndex.get(sha(token).toString('hex')) || null : null;
  }
  function attachToken(res, req, visitor) {
    const token = crypto.randomBytes(24).toString('base64url');
    const hash = sha(token).toString('hex');
    visitor.tokens.push(hash);
    if (visitor.tokens.length > 6) tokenIndex.delete(visitor.tokens.shift()); // höchstens 6 Geräte
    tokenIndex.set(hash, visitor);
    res.append('Set-Cookie', `woc_visitor=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${VISITOR_MS / 1000}${req.secure ? '; Secure' : ''}`);
  }
  /** Besucher zum Cookie finden – oder (falls erlaubt) neu anlegen. */
  function ensureVisitor(req, res) {
    let v = visitorFrom(req);
    if (v) { v.lastSeen = Date.now(); return v; }
    const d = p();
    if (d.visitors.length >= MAX_VISITORS || !rateLimit('vnew:' + req.socket.remoteAddress, 120, 10 * 60_000)) return null;
    let code;
    do { code = randomCode(8); } while (d.visitors.some((x) => x.code === code));
    v = { id: newId(), code, tokens: [], createdAt: Date.now(), lastSeen: Date.now() };
    d.visitors.push(v);
    attachToken(res, req, v);
    save();
    return v;
  }
  const fmtCode = (c) => `${c.slice(0, c.length / 2)}-${c.slice(c.length / 2)}`; // ABCD-EFGH bzw. ABCDE-FGHIJ

  function balance(v) {
    const d = p();
    const earned = d.challenges.done.filter((x) => x.v === v.id).reduce((s, x) => s + x.points, 0);
    const spent = d.shop.coupons.filter((c) => c.v === v.id && !c.cancelledAt).reduce((s, c) => s + c.price, 0);
    return { earned, spent, points: earned - spent };
  }

  /* ------------------------------------------------------------------ */
  /* Challenges                                                          */
  /* ------------------------------------------------------------------ */
  /** Löst einen gescannten Code ein. Ergebnis: ok | already | inactive | invalid */
  function claim(v, token) {
    const d = p();
    const c = d.challenges;
    token = String(token || '');
    const qr = c.qr.find((x) => x.token === token);
    const station = !qr && c.stations.find((x) => x.token === token);
    if (!qr && !station) return { status: 'invalid' };
    if (qr && !qr.active) return { status: 'inactive', kind: 'qr', name: qr.title };
    const kind = qr ? 'qr' : 'station';
    const item = qr || station;
    const name = qr ? qr.title : station.name;
    if (c.done.some((x) => x.v === v.id && x.kind === kind && x.ref === item.id)) return { status: 'already', kind, name };
    const points = qr ? qr.points : settings().stationPoints;
    c.done.push({ v: v.id, kind, ref: item.id, points, at: Date.now() });
    const out = { status: 'ok', kind, name, points };
    if (station) {
      const visited = new Set(c.done.filter((x) => x.v === v.id && x.kind === 'station').map((x) => x.ref));
      const complete = c.stations.length > 0 && c.stations.every((s) => visited.has(s.id));
      if (complete && !c.done.some((x) => x.v === v.id && x.kind === 'tour')) {
        const bonus = settings().tourBonus;
        c.done.push({ v: v.id, kind: 'tour', ref: 'tour', points: bonus, at: Date.now() });
        out.tourComplete = true;
        out.bonus = bonus;
      }
    }
    changed('challenges', ['admin']);
    return out;
  }

  function visitorState(v) {
    const d = p();
    const c = d.challenges;
    const mine = c.done.filter((x) => x.v === v.id);
    const doneAt = (kind, ref) => (mine.find((x) => x.kind === kind && x.ref === ref) || {}).at || null;
    const stations = [...c.stations].sort(byOrder).map((s) => ({ id: s.id, name: s.name, description: s.description, doneAt: doneAt('station', s.id) }));
    const used = new Map();
    for (const cp of d.shop.coupons) if (!cp.cancelledAt) used.set(cp.item, (used.get(cp.item) || 0) + 1);
    const fb = d.feedback.find((f) => f.vh === sha('fb:' + v.id).toString('hex'));
    return {
      now: Date.now(),
      title: settings().title,
      visitor: { code: fmtCode(v.code), ...balance(v) },
      program: [...d.program].sort(byOrder).map(({ id, title, description, start, end, highlight }) => ({ id, title, description, start, end, highlight })),
      challenges: {
        qr: c.qr.filter((q) => q.active).map((q) => ({ id: q.id, title: q.title, hint: q.hint, points: q.points, doneAt: doneAt('qr', q.id) })),
        stations,
        visited: stations.filter((s) => s.doneAt).length,
        tourDoneAt: doneAt('tour', 'tour'),
        stationPoints: settings().stationPoints,
        tourBonus: settings().tourBonus,
      },
      shop: {
        items: d.shop.items.filter((i) => i.active).sort(byOrder).map((i) => ({
          id: i.id, name: i.name, description: i.description, price: i.price,
          left: i.stock == null ? null : Math.max(0, i.stock - (used.get(i.id) || 0)),
          image: i.image ? `/media/${i.image}` : null,
        })),
        coupons: d.shop.coupons.filter((cp) => cp.v === v.id && !cp.cancelledAt).sort((a, b) => b.createdAt - a.createdAt)
          .map((cp) => ({ id: cp.id, code: fmtCode(cp.code), itemName: cp.itemName, price: cp.price, createdAt: cp.createdAt, redeemedAt: cp.redeemedAt || null })),
      },
      feedback: fb ? { rating: fb.rating, text: fb.text, at: fb.updatedAt || fb.at } : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Seiten                                                              */
  /* ------------------------------------------------------------------ */
  app.get('/app', page('portal.html'));
  for (const [route, tab] of [['/programm', 'programm'], ['/challenges', 'challenges'], ['/shop', 'shop'], ['/feedback', 'feedback']]) {
    app.get(route, (_req, res) => res.redirect(302, `/app#${tab}`));
  }
  app.get('/einloesen/:code', page('redeem.html'));
  app.get('/vendor/jsQR.js', (_req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js')));

  // Ziel aller gedruckten QR-Codes: mit der normalen Kamera-App scannen -> hier landen -> gutschreiben
  app.get('/c/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const v = ensureVisitor(req, res);
    if (!v) return res.redirect(302, '/app?found=busy#challenges');
    const r = claim(v, req.params.token);
    const q = new URLSearchParams({ found: r.status });
    if (r.kind) q.set('kind', r.kind);
    if (r.name) q.set('name', r.name);
    if (r.points) q.set('pts', String(r.points));
    if (r.tourComplete) q.set('tour', String(r.bonus));
    res.redirect(302, `/app?${q}#challenges`);
  });

  /* ------------------------------------------------------------------ */
  /* Besucher-API                                                        */
  /* ------------------------------------------------------------------ */
  app.use('/api/v', express.json({ limit: '20kb' }));

  app.get('/api/v/state', (req, res) => {
    const v = ensureVisitor(req, res);
    if (!v) return res.status(429).json({ error: 'Gerade sind zu viele neue Besucher – bitte gleich nochmal versuchen.' });
    res.json(visitorState(v));
  });

  app.get('/api/v/qr.svg', async (req, res) => {
    res.type('image/svg+xml').send(await QRCode.toString(`${publicBase(req)}/app`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });

  app.post('/api/v/claim', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
    const v = visitorFrom(req);
    if (!v) return res.status(401).json({ error: 'Bitte die Seite neu laden.' });
    if (!rateLimit('claim:' + v.id, 30, 60_000)) return res.status(429).json({ error: 'Zu viele Versuche, bitte kurz warten.' });
    res.json(claim(v, req.body?.token));
  });

  app.post('/api/v/restore', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
    if (!rateLimit('restore:' + req.socket.remoteAddress, 10, 10 * 60_000)) return res.status(429).json({ error: 'Zu viele Versuche. Bitte in ein paar Minuten nochmal.' });
    const code = normCode(req.body?.code);
    const v = code.length === 8 && p().visitors.find((x) => x.code === code);
    if (!v) return res.status(404).json({ error: 'Diesen Besucher-Code gibt es nicht.' });
    attachToken(res, req, v);
    save();
    res.json(visitorState(v));
  });

  app.post('/api/v/feedback', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
    const v = visitorFrom(req);
    if (!v) return res.status(401).json({ error: 'Bitte die Seite neu laden.' });
    if (!rateLimit('fb:' + req.socket.remoteAddress, 20, 60 * 60_000)) return res.status(429).json({ error: 'Zu viele Feedbacks von diesem Gerät. Bitte später nochmal.' });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Bitte wähle einen Smiley aus.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000) : '';
    const d = p();
    // anonym: gespeichert wird nur ein Hash, damit jedes Gerät eine Bewertung hat (die es ändern kann)
    const vh = sha('fb:' + v.id).toString('hex');
    let fb = d.feedback.find((f) => f.vh === vh);
    if (fb) Object.assign(fb, { rating, text, updatedAt: Date.now(), read: false });
    else d.feedback.push(fb = { id: newId(), vh, rating, text, at: Date.now(), read: false });
    changed('feedback', ['admin']);
    res.json({ ok: true, updated: !!fb.updatedAt });
  });

  app.post('/api/v/shop/:id', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Ungültige Herkunft' });
    const v = visitorFrom(req);
    if (!v) return res.status(401).json({ error: 'Bitte die Seite neu laden.' });
    if (!rateLimit('buy:' + v.id, 20, 60_000)) return res.status(429).json({ error: 'Zu viele Versuche, bitte kurz warten.' });
    const d = p();
    const item = d.shop.items.find((i) => i.id === req.params.id && i.active);
    if (!item) return res.status(404).json({ error: 'Diesen Artikel gibt es nicht mehr.' });
    const used = d.shop.coupons.filter((c) => c.item === item.id && !c.cancelledAt).length;
    if (item.stock != null && used >= item.stock) return res.status(409).json({ error: 'Leider ausverkauft.' });
    const { points } = balance(v);
    if (points < item.price) return res.status(409).json({ error: `Dir fehlen noch ${item.price - points} Punkte.` });
    let code;
    do { code = randomCode(10); } while (d.shop.coupons.some((c) => c.code === code));
    const coupon = { id: newId(), code, v: v.id, item: item.id, itemName: item.name, price: item.price, createdAt: Date.now(), redeemedAt: null, redeemedBy: null, cancelledAt: null };
    d.shop.coupons.push(coupon);
    changed('shop');
    res.status(201).json(visitorState(v));
  });

  app.get('/api/v/coupons/:id/qr.svg', async (req, res) => {
    const v = visitorFrom(req);
    const cp = v && p().shop.coupons.find((c) => c.id === req.params.id && c.v === v.id);
    if (!cp) return res.status(404).end();
    res.type('image/svg+xml').send(await QRCode.toString(`${publicBase(req)}/einloesen/${fmtCode(cp.code)}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });

  /* ------------------------------------------------------------------ */
  /* Admin-API                                                           */
  /* ------------------------------------------------------------------ */
  function stats() {
    const d = p();
    const c = d.challenges;
    const visitsOf = (kind, ref) => new Set(c.done.filter((x) => x.kind === kind && x.ref === ref).map((x) => x.v)).size;
    const perVisitor = new Map();
    for (const x of c.done) {
      if (x.kind !== 'station' || !c.stations.some((s) => s.id === x.ref)) continue;
      perVisitor.set(x.v, (perVisitor.get(x.v) || 0) + 1);
    }
    const distribution = Array.from({ length: c.stations.length + 1 }, (_, k) => [...perVisitor.values()].filter((n) => n === k).length);
    distribution[0] = 0; // nur Besucher, die mitgemacht haben
    const ratings = [1, 2, 3, 4, 5].map((r) => d.feedback.filter((f) => f.rating === r).length);
    const earned = c.done.reduce((s, x) => s + x.points, 0);
    const active = d.shop.coupons.filter((x) => !x.cancelledAt);
    return {
      visitors: d.visitors.length,
      visitorsToday: d.visitors.filter((v) => v.lastSeen > Date.now() - 86400_000).length,
      participants: new Set(c.done.map((x) => x.v)).size,
      qrFinders: Object.fromEntries(c.qr.map((q) => [q.id, visitsOf('qr', q.id)])),
      stationVisits: Object.fromEntries(c.stations.map((s) => [s.id, visitsOf('station', s.id)])),
      tours: c.done.filter((x) => x.kind === 'tour').length,
      distribution,
      pointsEarned: earned,
      pointsSpent: active.reduce((s, x) => s + x.price, 0),
      coupons: active.length,
      couponsRedeemed: active.filter((x) => x.redeemedAt).length,
      feedback: { count: d.feedback.length, avg: d.feedback.length ? d.feedback.reduce((s, f) => s + f.rating, 0) / d.feedback.length : null, ratings },
    };
  }
  const adminCoupon = (cp) => ({
    id: cp.id, code: fmtCode(cp.code), itemName: cp.itemName, price: cp.price, createdAt: cp.createdAt,
    redeemedAt: cp.redeemedAt, redeemedBy: cp.redeemedBy, cancelledAt: cp.cancelledAt,
    visitor: (() => { const v = p().visitors.find((x) => x.id === cp.v); return v ? fmtCode(v.code) : '–'; })(),
  });

  app.get('/api/admin/portal', requireAdmin, (req, res) => {
    const d = p();
    res.json({
      url: `${publicBase(req)}/app`,
      stats: stats(),
      feedback: d.feedback.map(({ id, rating, text, at, updatedAt, read }) => ({ id, rating, text, at, updatedAt, read })),
      program: [...d.program].sort(byOrder),
      qr: d.challenges.qr.map((q) => ({ ...q, url: `${publicBase(req)}/c/${q.token}` })),
      stations: [...d.challenges.stations].sort(byOrder).map((s) => ({ ...s, url: `${publicBase(req)}/c/${s.token}` })),
      shop: {
        items: [...d.shop.items].sort(byOrder).map((i) => ({
          ...i, image: i.image ? `/media/${i.image}` : null,
          used: d.shop.coupons.filter((c) => c.item === i.id && !c.cancelledAt).length,
        })),
        coupons: [...d.shop.coupons].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500).map(adminCoupon),
      },
    });
  });

  /* ---------- Feedback ---------- */
  app.patch('/api/admin/feedback/:id', requireAdmin, (req, res) => {
    const fb = p().feedback.find((f) => f.id === req.params.id);
    if (!fb) return res.status(404).json({ error: 'Nicht gefunden' });
    if (typeof req.body?.read === 'boolean') fb.read = req.body.read;
    changed('feedback', ['admin']);
    res.json({ ok: true });
  });
  app.delete('/api/admin/feedback/:id', requireAdmin, (req, res) => {
    const d = p();
    d.feedback = d.feedback.filter((f) => f.id !== req.params.id);
    changed('feedback', ['admin']);
    res.json({ ok: true });
  });
  app.get('/api/admin/feedback.csv', requireAdmin, (_req, res) => {
    const cell = (s) => `"${String(s).replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`; // keine Formeln in Excel
    const rows = [['Datum', 'Bewertung (1-5)', 'Text', 'Gelesen'].map(cell).join(';')];
    for (const f of [...p().feedback].sort((a, b) => a.at - b.at)) {
      rows.push([new Date(f.updatedAt || f.at).toLocaleString('de-DE'), f.rating, f.text, f.read ? 'ja' : 'nein'].map(cell).join(';'));
    }
    res.set('Content-Disposition', 'attachment; filename="feedback.csv"').type('text/csv; charset=utf-8').send('﻿' + rows.join('\r\n'));
  });

  /* ---------- Programm ---------- */
  function parseProgram(b) {
    const title = clean(b?.title, 80);
    const description = typeof b?.description === 'string' ? b.description.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 300) : '';
    const start = Number(b?.start), end = Number(b?.end);
    if (title.length < 2) return { error: 'Bitte einen Titel eingeben' };
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'Bitte Start- und Endzeit angeben' };
    if (end <= start) return { error: 'Die Endzeit muss nach der Startzeit liegen' };
    if (end - start > 2 * 86400_000) return { error: 'Ein Programmpunkt darf höchstens 48 Stunden dauern' };
    return { title, description, start, end, highlight: b?.highlight === true };
  }
  app.post('/api/admin/program', requireAdmin, (req, res) => {
    const item = parseProgram(req.body);
    if (item.error) return res.status(400).json(item);
    const d = p();
    if (d.program.length >= 300) return res.status(400).json({ error: 'Zu viele Programmpunkte' });
    d.program.push({ id: newId(), ...item, order: nextOrder(d.program) });
    changed('program');
    res.status(201).json({ ok: true });
  });
  app.put('/api/admin/program/:id', requireAdmin, (req, res) => {
    const old = p().program.find((x) => x.id === req.params.id);
    if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
    const item = parseProgram(req.body);
    if (item.error) return res.status(400).json(item);
    Object.assign(old, item);
    changed('program');
    res.json({ ok: true });
  });
  app.delete('/api/admin/program/:id', requireAdmin, (req, res) => {
    const d = p();
    d.program = d.program.filter((x) => x.id !== req.params.id);
    changed('program');
    res.json({ ok: true });
  });
  function move(list, id, dir) {
    const sorted = [...list].sort(byOrder);
    const i = sorted.findIndex((x) => x.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= sorted.length) return false;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    sorted.forEach((x, n) => { x.order = n + 1; });
    return true;
  }
  app.post('/api/admin/program/:id/move', requireAdmin, (req, res) => {
    move(p().program, req.params.id, Number(req.body?.dir));
    changed('program');
    res.json({ ok: true });
  });
  app.post('/api/admin/program/sort', requireAdmin, (_req, res) => {
    [...p().program].sort((a, b) => a.start - b.start || a.end - b.end).forEach((x, n) => { x.order = n + 1; });
    changed('program');
    res.json({ ok: true });
  });

  /* ---------- Schatzsuche (versteckte QR-Codes) ---------- */
  function parseQr(b) {
    const title = clean(b?.title, 100);
    const hint = clean(b?.hint, 200);
    const points = Number(b?.points);
    if (title.length < 3) return { error: 'Bitte eine Aufgabe eingeben' };
    if (!Number.isInteger(points) || points < 0 || points > 10000) return { error: 'Punkte: 0 bis 10000' };
    return { title, hint, points, active: b?.active !== false };
  }
  app.post('/api/admin/challenges/qr', requireAdmin, (req, res) => {
    const q = parseQr(req.body);
    if (q.error) return res.status(400).json(q);
    if (p().challenges.qr.length >= 100) return res.status(400).json({ error: 'Zu viele Challenges' });
    p().challenges.qr.push({ id: newId(), ...q, token: newToken() });
    changed('challenges');
    res.status(201).json({ ok: true });
  });
  app.put('/api/admin/challenges/qr/:id', requireAdmin, (req, res) => {
    const old = p().challenges.qr.find((x) => x.id === req.params.id);
    if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
    const q = parseQr(req.body);
    if (q.error) return res.status(400).json(q);
    Object.assign(old, q);
    changed('challenges');
    res.json({ ok: true });
  });
  app.delete('/api/admin/challenges/qr/:id', requireAdmin, (req, res) => {
    const c = p().challenges;
    c.qr = c.qr.filter((x) => x.id !== req.params.id); // bereits verdiente Punkte bleiben erhalten
    changed('challenges');
    res.json({ ok: true });
  });

  /* ---------- Rundgang (Stationen) ---------- */
  function parseStation(b) {
    const name = clean(b?.name, 60);
    const description = clean(b?.description, 240);
    if (name.length < 2) return { error: 'Bitte einen Namen eingeben' };
    return { name, description };
  }
  app.post('/api/admin/stations', requireAdmin, (req, res) => {
    const s = parseStation(req.body);
    if (s.error) return res.status(400).json(s);
    const c = p().challenges;
    if (c.stations.length >= 100) return res.status(400).json({ error: 'Zu viele Stationen' });
    c.stations.push({ id: newId(), ...s, token: newToken(), order: nextOrder(c.stations) });
    changed('challenges');
    res.status(201).json({ ok: true });
  });
  app.put('/api/admin/stations/:id', requireAdmin, (req, res) => {
    const old = p().challenges.stations.find((x) => x.id === req.params.id);
    if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
    const s = parseStation(req.body);
    if (s.error) return res.status(400).json(s);
    Object.assign(old, s);
    changed('challenges');
    res.json({ ok: true });
  });
  app.delete('/api/admin/stations/:id', requireAdmin, (req, res) => {
    const c = p().challenges;
    c.stations = c.stations.filter((x) => x.id !== req.params.id);
    changed('challenges');
    res.json({ ok: true });
  });
  app.post('/api/admin/stations/:id/move', requireAdmin, (req, res) => {
    move(p().challenges.stations, req.params.id, Number(req.body?.dir));
    changed('challenges');
    res.json({ ok: true });
  });

  /* ---------- QR-Codes: neu erzeugen, herunterladen, drucken ---------- */
  const findCode = (kind, id) => (kind === 'qr' ? p().challenges.qr : kind === 'station' ? p().challenges.stations : []).find((x) => x.id === id);
  app.post('/api/admin/qrcode/:kind/:id/renew', requireAdmin, (req, res) => {
    const item = findCode(req.params.kind, req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    item.token = newToken(); // alter gedruckter Code ist ab sofort ungültig
    changed('challenges', ['admin']);
    res.json({ ok: true });
  });
  app.get('/api/admin/qrcode/:kind/:id.png', requireAdmin, async (req, res) => {
    const item = findCode(req.params.kind, req.params.id);
    if (!item) return res.status(404).end();
    const png = await QRCode.toBuffer(`${publicBase(req)}/c/${item.token}`, { type: 'png', width: 1200, margin: 2, errorCorrectionLevel: 'M' });
    const name = (item.name || item.title || 'qr').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'qr';
    res.set('Content-Disposition', `attachment; filename="qr-${encodeURIComponent(name)}.png"`).type('image/png').send(png);
  });

  // Druckansicht: eine Seite pro QR-Code (A4)
  app.get('/admin/print/:kind{/:id}', async (req, res) => {
    if (!ctx.isAdmin(req)) return res.redirect(302, '/admin');
    const { kind, id } = req.params;
    const c = p().challenges;
    let list = [];
    if (kind === 'stations') list = [...c.stations].sort(byOrder).map((s) => ({ ...s, kind: 'station' }));
    else if (kind === 'station' || kind === 'qr') { const x = findCode(kind, id); if (x) list = [{ ...x, kind }]; }
    if (!list.length) return res.status(404).type('text').send('Nicht gefunden');
    const title = escapeHtml(settings().title);
    const logo = logoUrl();
    const pages = await Promise.all(list.map(async (x) => {
      const svg = await QRCode.toString(`${publicBase(req)}/c/${x.token}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
      const head = x.kind === 'station' ? escapeHtml(x.name) : 'Geschafft – du hast mich gefunden!';
      const sub = x.kind === 'station'
        ? escapeHtml(x.description || '')
        : `${escapeHtml(x.title)}<br>Scanne den Code und hol dir <b>${x.points} Punkte</b>.`;
      const kick = x.kind === 'station' ? 'Digitaler Rundgang · Station' : 'QR-Code-Challenge';
      return `<section class="sheet"><p class="kick">${kick}</p><h1>${head}</h1><p class="sub">${sub}</p>
        <div class="qr">${svg}</div><p class="how">📱 Mit der Handykamera scannen – oder in der Besucher-App auf „QR-Code scannen“ tippen.</p>
        <footer><span>${title}</span>${logo ? `<img src="${logo}" alt="">` : ''}</footer></section>`;
    }));
    res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>QR-Codes drucken</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #eee; }
  .bar { position: sticky; top: 0; background: #000a3e; color: #fff; padding: 12px 20px; display: flex; gap: 12px; align-items: center; }
  .bar button { font: inherit; font-weight: 700; background: #e10b70; color: #fff; border: 0; border-radius: 10px; padding: 8px 16px; cursor: pointer; }
  .sheet { width: 210mm; height: 297mm; margin: 10mm auto; background: #fff; box-sizing: border-box; padding: 22mm 20mm 16mm; display: flex; flex-direction: column;
    align-items: center; text-align: center; break-after: page; position: relative; overflow: hidden; }
  .sheet::before { content: ""; position: absolute; inset: 0 0 auto; height: 12mm; background: linear-gradient(90deg, #000a3e, #e10b70); }
  .kick { margin: 0; font-size: 12pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 800; color: #e10b70; }
  h1 { font-size: 34pt; margin: 6mm 0 4mm; color: #000a3e; line-height: 1.1; }
  .sub { font-size: 15pt; color: #333; margin: 0 0 8mm; max-width: 160mm; }
  .qr { width: 130mm; height: 130mm; } .qr svg { width: 100%; height: 100%; display: block; }
  .how { font-size: 13pt; color: #555; margin-top: 8mm; max-width: 150mm; }
  footer { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: center; color: #000a3e; font-weight: 800; font-size: 13pt; }
  footer img { height: 12mm; filter: invert(1); }
  @media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; } }
</style></head><body>
<div class="bar"><button id="print">🖨️ Drucken</button><span>${list.length} Seite${list.length > 1 ? 'n' : ''} · am besten auf A4, Hochformat</span></div>
${pages.join('\n')}
<script src="/js/print.js"></script></body></html>`);
  });

  /* ---------- Shop ---------- */
  function parseItem(b) {
    const name = clean(b?.name, 60);
    const description = clean(b?.description, 200);
    const price = Number(b?.price);
    const stock = b?.stock === null || b?.stock === '' || b?.stock === undefined ? null : Number(b.stock);
    if (name.length < 2) return { error: 'Bitte einen Namen eingeben' };
    if (!Number.isInteger(price) || price < 1 || price > 100000) return { error: 'Preis: 1 bis 100000 Punkte' };
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) return { error: 'Bestand: leer (unbegrenzt) oder 0 bis 100000' };
    return { name, description, price, stock, active: b?.active !== false };
  }
  app.post('/api/admin/shop', requireAdmin, (req, res) => {
    const it = parseItem(req.body);
    if (it.error) return res.status(400).json(it);
    const s = p().shop;
    if (s.items.length >= 200) return res.status(400).json({ error: 'Zu viele Artikel' });
    const item = { id: newId(), ...it, image: null, order: nextOrder(s.items) };
    s.items.push(item);
    changed('shop');
    res.status(201).json({ id: item.id });
  });
  app.put('/api/admin/shop/:id', requireAdmin, (req, res) => {
    const old = p().shop.items.find((x) => x.id === req.params.id);
    if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
    const it = parseItem(req.body);
    if (it.error) return res.status(400).json(it);
    Object.assign(old, it);
    changed('shop');
    res.json({ ok: true });
  });
  app.delete('/api/admin/shop/:id', requireAdmin, async (req, res) => {
    const s = p().shop;
    const item = s.items.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    s.items = s.items.filter((x) => x !== item); // ausgegebene Coupons bleiben gültig
    if (item.image) await fsp.rm(path.join(UPLOADS, item.image), { force: true });
    changed('shop');
    res.json({ ok: true });
  });
  app.put('/api/admin/shop/:id/image', requireAdmin, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), async (req, res) => {
    const item = p().shop.items.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[contentType(req)];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 50) return res.status(415).json({ error: 'Bitte ein JPG-, PNG- oder WebP-Bild hochladen' });
    const file = `shop-${item.id}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(UPLOADS, file), req.body, { flag: 'wx' });
    if (item.image) await fsp.rm(path.join(UPLOADS, item.image), { force: true });
    item.image = file;
    changed('shop');
    res.json({ ok: true });
  });

  /* ---------- Coupons prüfen und einlösen ---------- */
  const findCoupon = (code) => { const n = normCode(code); return n.length === 10 && p().shop.coupons.find((c) => c.code === n); };
  app.get('/api/admin/coupons/:code', requireAdmin, (req, res) => {
    const cp = findCoupon(req.params.code);
    if (!cp) return res.status(404).json({ error: 'Diesen Coupon gibt es nicht. Bitte den Code prüfen.' });
    res.json({ coupon: adminCoupon(cp) });
  });
  app.post('/api/admin/coupons/:code/redeem', requireAdmin, (req, res) => {
    const cp = findCoupon(req.params.code);
    if (!cp) return res.status(404).json({ error: 'Diesen Coupon gibt es nicht. Bitte den Code prüfen.' });
    if (cp.cancelledAt) return res.status(409).json({ error: 'Dieser Coupon wurde storniert.', coupon: adminCoupon(cp) });
    if (cp.redeemedAt) {
      return res.status(409).json({
        error: `Bereits eingelöst: ${new Date(cp.redeemedAt).toLocaleString('de-DE')} Uhr${cp.redeemedBy ? ` (${cp.redeemedBy})` : ''}`,
        coupon: adminCoupon(cp),
      });
    }
    cp.redeemedAt = Date.now();
    cp.redeemedBy = req.user.name;
    changed('shop');
    res.json({ coupon: adminCoupon(cp) });
  });
  app.post('/api/admin/coupons/:code/cancel', requireAdmin, (req, res) => {
    const cp = findCoupon(req.params.code);
    if (!cp) return res.status(404).json({ error: 'Nicht gefunden' });
    if (cp.redeemedAt) return res.status(409).json({ error: 'Eingelöste Coupons können nicht storniert werden.' });
    if (!cp.cancelledAt) cp.cancelledAt = Date.now(); // Punkte gehen zurück, Bestand wird wieder frei
    changed('shop');
    res.json({ coupon: adminCoupon(cp) });
  });

  // Komplett zurücksetzen (z. B. vor der Veranstaltung nach dem Testen)
  app.post('/api/admin/portal/reset', requireAdmin, (req, res) => {
    const d = p();
    const what = req.body?.what;
    if (what === 'progress') {
      d.challenges.done = [];
      d.shop.coupons = [];
      d.visitors = [];
      reindex();
    } else if (what === 'feedback') {
      d.feedback = [];
    } else {
      return res.status(400).json({ error: 'Unbekannt' });
    }
    changed('challenges');
    broadcast('shop', {}, ['visitor']);
    res.json({ ok: true });
  });

  return { stats, visitorCount: () => p().visitors.length };
};
