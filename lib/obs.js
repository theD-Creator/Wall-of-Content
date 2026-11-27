'use strict';
/**
 * OBS-Livestream auf der Wall.
 *   OBS → Einstellungen → Stream → Dienst „Benutzerdefiniert“
 *        Server:     rtmp://<laptop-ip>:1935/live
 *        Stream-Key: steht im Admin-Panel unter „Livestream“
 * Die Wall spielt den Stream ab, solange er läuft (groß, auf der Bühne oder als Bild-im-Bild).
 *
 *   GET  /api/obs/live.flv      – laufender Stream als HTTP-FLV (für mpegts.js); 404, wenn nichts läuft
 *   GET  /api/admin/obs         – Status, Server-Adresse, Stream-Key
 *   POST /api/admin/obs/key     – neuen Stream-Key erzeugen (laufender Stream wird beendet)
 */
const crypto = require('crypto');
const { RtmpServer } = require('./rtmp');

module.exports = function obs(ctx) {
  const { app, getDb, save, broadcast, requireAdmin, requestHostname } = ctx;
  const port = process.env.RTMP_PORT === '0' ? 0 : Number(process.env.RTMP_PORT) || 1935;
  const db = () => getDb();
  const newKey = () => 'woc-' + crypto.randomBytes(9).toString('base64url');
  if (!db().obs || !db().obs.key) { db().obs = { key: newKey() }; save(); }

  let error = null;
  const rtmp = new RtmpServer({
    port,
    checkKey: (k) => !!k && crypto.timingSafeEqual(crypto.createHash('sha256').update(k).digest(), crypto.createHash('sha256').update(db().obs.key).digest()),
  });
  const state = () => ({ live: rtmp.live, since: rtmp.since, info: rtmp.info });
  rtmp.on('change', () => broadcast('obs', state()));
  rtmp.on('log', (m) => console.log('  ' + m));
  rtmp.on('error', (e) => {
    error = e.code === 'EADDRINUSE' ? `Port ${port} ist schon belegt (läuft ein anderer Streaming-Server?). Anderen Port mit RTMP_PORT=1936 wählen.` : e.message;
    console.error('  Livestream (RTMP):', error);
  });
  if (port) rtmp.listen();

  app.get('/api/obs/live.flv', (req, res) => {
    if (!rtmp.live) return res.status(404).json({ error: 'Gerade läuft kein Livestream' });
    if (rtmp.viewers.size >= 30) return res.status(503).json({ error: 'Zu viele Zuschauer' });
    res.writeHead(200, { 'Content-Type': 'video/x-flv', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    req.socket.setNoDelay(true);
    rtmp.addViewer(res);
  });

  app.get('/api/admin/obs', requireAdmin, (req, res) => {
    res.json({
      ...state(), viewers: rtmp.viewers.size, port, error,
      server: port ? `rtmp://${requestHostname(req)}:${port}/live` : null,
      key: db().obs.key,
    });
  });
  app.post('/api/admin/obs/key', requireAdmin, (_req, res) => {
    db().obs.key = newKey();
    save();
    if (rtmp.publisher) rtmp.publisher.destroy(); // alter Key gilt sofort nicht mehr
    res.json({ key: db().obs.key });
  });

  return { state };
};
