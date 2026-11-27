'use strict';
/**
 * Live-Modus: Die Redaktion fotografiert/filmt „Moments“ mit dem Handy (/live). Ein Moment ist ein normaler
 * Inhalt der Wall mit Zusatzinfos (wer, Bildunterschrift, Hashtags). Je nach Einstellung erscheint er sofort groß
 * auf der Bühne, erst nach Freigabe im Admin und/oder im Live-Ticker.
 *
 *   GET    /live                         – Live-Kamera (Anmeldung mit Redaktions-, Admin- oder Global-Konto)
 *   GET    /api/live/me                  – angemeldet? + Hashtag-Vorschläge
 *   GET    /api/live/moments             – eigene Moments (neueste zuerst) mit Status
 *   POST   /api/live/moments?caption&tags – Foto/Video hochladen (Body = Datei)
 *   PUT    /api/live/moments/:id/thumb   – Vorschaubild (JPEG) für Videos
 *   DELETE /api/live/moments/:id         – eigenen Moment löschen
 *   GET    /api/admin/moments            – alle Moments für das Admin-Panel
 */
const path = require('path');
const fsp = require('fs').promises;

module.exports = function moments(ctx) {
  const {
    app, express, getDb, save, broadcast, requireEditor, requireAdmin, newId, clean, normTags, saveStream,
    UPLOADS, MEDIA_TYPES, MAX_MEDIA, MAX_MEMORY, contentType, page, publicItem, adminItem, deleteItem,
  } = ctx;

  app.get('/live', page('live.html'));

  const suggestions = () => normTags(getDb().settings.momentTags || '');
  const mine = (req, item) => item.moment && (item.moment.userId === req.user.id || req.user.role !== 'redaktion');
  const status = (i) => (i.onWall ? 'live' : i.reviewed === false ? 'pending' : 'hidden');

  app.get('/api/live/me', requireEditor, (req, res) => {
    const s = getDb().settings;
    res.json({
      user: { id: req.user.id, name: req.user.name, role: req.user.role },
      tags: suggestions(),
      approval: !!s.momentApproval,
      title: s.title,
    });
  });

  app.get('/api/live/moments', requireEditor, (req, res) => {
    const list = getDb().items.filter((i) => i.moment && i.moment.userId === req.user.id)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
      .map((i) => ({ ...publicItem(i), status: status(i) }));
    res.json({ moments: list });
  });

  app.post('/api/live/moments', requireEditor, async (req, res) => {
    const db = getDb();
    const type = contentType(req);
    const ext = MEDIA_TYPES[type];
    if (!ext) return res.status(415).json({ error: 'Bitte ein Foto (JPG, PNG, WebP) oder Video (MP4, MOV, WebM) wählen' });
    const id = newId();
    const file = `moment-${id}${ext}`;
    await saveStream(req, path.join(UPLOADS, file), MAX_MEDIA);
    const approval = !!db.settings.momentApproval;
    const caption = clean(String(req.query.caption || ''), 200);
    const w = Number(req.query.w), h = Number(req.query.h);
    const item = {
      id, kind: type.startsWith('video/') ? 'video' : 'image', file, thumb: null,
      title: clean(caption, 80), createdAt: Date.now(),
      onWall: !approval, reviewed: !approval,
      moment: {
        by: req.user.name, userId: req.user.id, avatar: req.user.avatar ? `/assets/avatars/${encodeURIComponent(req.user.avatar)}` : null,
        caption, tags: normTags(String(req.query.tags || '')), at: Date.now(),
      },
    };
    if (w > 0 && h > 0) item.ratio = Math.min(4, Math.max(0.25, Math.round(w / h * 1000) / 1000));
    db.items.push(item);
    save();
    broadcast('items', { added: item.onWall ? id : null });
    if (!item.onWall) broadcast('moments', {}, ['admin']);
    res.status(201).json({ moment: { ...publicItem(item), status: status(item) } });
  });

  app.put('/api/live/moments/:id/thumb', requireEditor, express.raw({ type: 'image/jpeg', limit: MAX_MEMORY }), async (req, res) => {
    const item = getDb().items.find((i) => i.id === req.params.id);
    if (!item || !mine(req, item)) return res.status(404).json({ error: 'Nicht gefunden' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'Kein Bild' });
    const thumb = `thumb-${item.id}.jpg`;
    await fsp.writeFile(path.join(UPLOADS, thumb), req.body);
    item.thumb = thumb;
    save();
    broadcast('items');
    res.json({ ok: true });
  });

  app.delete('/api/live/moments/:id', requireEditor, async (req, res) => {
    const item = getDb().items.find((i) => i.id === req.params.id);
    if (!item || !mine(req, item)) return res.status(404).json({ error: 'Nicht gefunden' });
    await deleteItem(item);
    broadcast('items');
    res.json({ ok: true });
  });

  app.get('/api/admin/moments', requireAdmin, (_req, res) => {
    const list = getDb().items.filter((i) => i.moment).sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => ({ ...adminItem(i), status: status(i) }));
    res.json({ moments: list, tags: suggestions() });
  });
};
