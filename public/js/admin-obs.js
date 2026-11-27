'use strict';
/* Admin-Panel: OBS-Livestream – Status, Vorschau, Server-Adresse und Stream-Key für OBS */
(() => {
  const { call, toast } = window.adminApi;
  const panel = $('[data-panel="obs"]');
  const video = $('#obsPreview');
  let info = null;
  let player = null;
  let showKey = false;
  let timer = null;

  const since = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} Min` : `${Math.floor(s / 3600)} Std ${Math.floor((s % 3600) / 60)} Min`;
  };

  function stopPreview() {
    if (!player) return;
    try { player.unload(); player.detachMediaElement(); player.destroy(); } catch { /* schon weg */ }
    player = null;
  }
  function startPreview() {
    if (player || !window.mpegts || !mpegts.getFeatureList().mseLivePlayback) return;
    player = mpegts.createPlayer({ type: 'flv', isLive: true, url: '/api/obs/live.flv' }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
    player.on(mpegts.Events.ERROR, () => { stopPreview(); });
    player.attachMediaElement(video);
    player.load();
    const r = player.play();
    if (r && r.catch) r.catch(() => {});
  }

  function render() {
    if (!info) return;
    $('#obsBadge').hidden = !info.live;
    const i = info.info || {};
    const details = [i.width && i.height ? `${i.width}×${i.height}` : '', i.fps ? `${Math.round(i.fps)} fps` : '',
      i.videoKbps ? `${Math.round(i.videoKbps)} kbit/s` : '', `${info.viewers} ${info.viewers === 1 ? 'Bildschirm' : 'Bildschirme'}`].filter(Boolean).join(' · ');
    $('#obsStatus').replaceChildren(info.error
      ? el('p', { class: 'error', text: info.error })
      : info.live
        ? el('div', { class: 'obs-on-air' }, el('span', { class: 'status live', text: '● LIVE' }), el('b', { text: `seit ${since(info.since)}` }), el('span', { class: 'muted small', text: details }))
        : el('div', { class: 'obs-on-air' }, el('span', { class: 'status', text: 'Kein Stream' }), el('span', { class: 'muted small', text: 'Warte auf OBS …' })));
    $('#obsServer').textContent = info.server || 'Livestream ist ausgeschaltet (RTMP_PORT=0)';
    $('#obsKey').textContent = showKey ? info.key : '•'.repeat(12);
    $('#obsKeyShow').textContent = showKey ? 'Verbergen' : 'Zeigen';
    const active = panel.classList.contains('active');
    $('#obsPreviewNote').hidden = info.live;
    video.hidden = !info.live;
    if (info.live && active) startPreview(); else stopPreview();
  }

  async function load() {
    clearTimeout(timer);
    try { info = await api('/api/admin/obs'); render(); } catch { /* nicht angemeldet */ }
    timer = setTimeout(load, panel.classList.contains('active') ? 2500 : 8000);
  }

  $('#obsKeyShow').addEventListener('click', () => { showKey = !showKey; render(); });
  for (const b of $$('[data-copy]', panel)) {
    b.addEventListener('click', async () => {
      const text = b.dataset.copy === 'obsKey' ? info && info.key : info && info.server;
      if (text && await copyText(text)) toast('Kopiert');
    });
  }
  $('#obsKeyNew').addEventListener('click', async () => {
    if (!confirm('Neuen Stream-Key erzeugen? Ein laufender Stream wird beendet, und in OBS muss der neue Key eingetragen werden.')) return;
    try { await call('/api/admin/obs/key', { method: 'POST' }); showKey = true; toast('Neuer Stream-Key erzeugt'); load(); } catch { /* Meldung kommt aus call() */ }
  });
  $('#tabs').addEventListener('click', () => setTimeout(load));
  load();
})();
