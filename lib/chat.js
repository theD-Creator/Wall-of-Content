'use strict';
/**
 * Interner Team-Chat für alle Mitarbeiter-Konten (Global Admin, Admin, Redaktion).
 *   GET    /chat                     – Chat als eigene Seite (z. B. auf dem Handy der Redaktion)
 *   GET    /api/staff/chat?after=ts  – Nachrichten (neueste 200 bzw. alle nach „after“)
 *   POST   /api/staff/chat           – Nachricht senden { text }
 *   DELETE /api/staff/chat/:id       – eigene Nachricht löschen (Admins: jede)
 */
module.exports = function chat(ctx) {
  const { app, express, getDb, save, broadcast, requireEditor, newId, rateLimit, page, publicUser } = ctx;
  const list = () => { const db = getDb(); if (!Array.isArray(db.chat)) db.chat = []; return db.chat; };
  const MAX = 1000;
  const view = (m) => {
    const u = getDb().users.find((x) => x.id === m.userId);
    return { id: m.id, userId: m.userId, name: u ? u.name : m.name, avatar: u ? publicUser(u).avatar : null, text: m.text, at: m.at };
  };

  app.get('/chat', page('chat.html'));
  app.use('/api/staff', express.json({ limit: '20kb' }));

  app.get('/api/staff/chat', requireEditor, (req, res) => {
    const incremental = req.query.after !== undefined;
    const after = Number(req.query.after) || 0;
    const all = list();
    const msgs = incremental ? all.filter((m) => m.at > after) : all.slice(-200);
    res.json({ me: publicUser(req.user), messages: msgs.map(view), ids: incremental ? all.slice(-200).map((m) => m.id) : undefined });
  });

  app.post('/api/staff/chat', requireEditor, (req, res) => {
    if (!rateLimit('chat:' + req.user.id, 30, 60_000)) return res.status(429).json({ error: 'Zu viele Nachrichten, bitte kurz warten' });
    const text = String(req.body?.text ?? '').replace(/\r/g, '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'Leere Nachricht' });
    const all = list();
    const last = all.length ? all[all.length - 1].at : 0;
    const m = { id: newId(), userId: req.user.id, name: req.user.name, text, at: Math.max(Date.now(), last + 1) };
    all.push(m);
    if (all.length > MAX) all.splice(0, all.length - MAX);
    save();
    broadcast('chat', { at: m.at }, ['admin']);
    res.status(201).json({ message: view(m) });
  });

  app.delete('/api/staff/chat/:id', requireEditor, (req, res) => {
    const all = list();
    const i = all.findIndex((m) => m.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Nicht gefunden' });
    if (all[i].userId !== req.user.id && req.user.role === 'redaktion') return res.status(403).json({ error: 'Nur eigene Nachrichten' });
    all.splice(i, 1);
    save();
    broadcast('chat', {}, ['admin']);
    res.json({ ok: true });
  });
};
