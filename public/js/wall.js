'use strict';
/* Wall of Content – schwebende Thumbnails, Klick öffnet Bild/Video */
(() => {
  const stage = $('#stage');
  const viewer = $('#viewer');
  const viewerMedia = $('#viewerMedia');
  const viewerBar = $('#viewerBar');
  const rand = (a, b) => a + Math.random() * (b - a);

  let settings = {};
  let items = [];              // alle Inhalte, die auf der Wall sein dürfen
  const bubbles = new Map();   // id -> Bubble (aktuell sichtbar)
  let loaded = false;
  let lastInteraction = performance.now();
  let current = null;          // aktuell geöffneter Inhalt
  let closeTimer = null;

  /* ---------------- Schwebende Kacheln ---------------- */
  class Bubble {
    constructor(item, fresh) {
      this.item = item;
      const scale = Math.min(innerWidth, innerHeight * 1.6) / 1728;
      const base = (settings.thumbSize || 200) * scale * rand(0.8, 1.25);
      const ratio = item.kind === 'photo' ? 3 / 4 : item.kind === 'video' ? 16 / 10 : 1;
      this.w = ratio >= 1 ? base * Math.sqrt(ratio) : base * ratio / Math.sqrt(ratio);
      this.h = this.w / ratio;
      this.r = Math.hypot(this.w, this.h) / 2 * 0.8;
      this.x = fresh ? innerWidth / 2 : rand(this.w / 2, innerWidth - this.w / 2);
      this.y = fresh ? innerHeight / 2 : rand(this.h / 2, innerHeight - this.h / 2);
      const dir = rand(0, Math.PI * 2);
      this.v = rand(14, 30);                 // Zielgeschwindigkeit in px/s
      this.vx = Math.cos(dir) * this.v;
      this.vy = Math.sin(dir) * this.v;
      this.phase = rand(0, Math.PI * 2);
      this.tilt = rand(2, 5);

      const media = item.thumb || item.kind !== 'video'
        ? el('img', { src: item.thumb || item.url, alt: '', draggable: false, loading: 'lazy' })
        : el('video', { src: item.url + '#t=0.5', muted: true, playsInline: true, preload: 'metadata' });
      this.el = el('button', { class: 'bubble' + (fresh ? ' fresh' : ''), 'aria-label': item.title || 'Inhalt öffnen' },
        el('span', { class: 'bubble-inner' },
          media,
          item.kind === 'video' && el('span', { class: 'bubble-play', text: '▶' }),
          fresh && el('span', { class: 'bubble-new', text: 'NEU' })));
      this.el.style.width = this.w + 'px';
      this.el.style.height = this.h + 'px';
      this.el.addEventListener('click', () => openViewer(item));
      stage.append(this.el);
      if (fresh) setTimeout(() => this.el.classList.remove('fresh'), 6000);
    }

    remove() {
      this.el.classList.add('leaving');
      setTimeout(() => this.el.remove(), 600);
    }
  }

  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const speed = current ? 0.25 : (settings.speed ?? 1);
    const list = [...bubbles.values()];
    const W = innerWidth, H = innerHeight;

    // sanftes Auseinanderschieben, damit sich Kacheln nicht stapeln
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (min - d) / min * 40 * dt;
          const nx = dx / d, ny = dy / d;
          a.vx -= nx * push; a.vy -= ny * push;
          b.vx += nx * push; b.vy += ny * push;
        }
      }
    }

    for (const b of list) {
      // Geschwindigkeit sanft zur Zielgeschwindigkeit zurückführen
      const v = Math.hypot(b.vx, b.vy) || 1;
      const k = 1 + (b.v - v) / v * Math.min(1, dt * 1.5);
      b.vx *= k; b.vy *= k;
      b.x += b.vx * dt * speed;
      b.y += b.vy * dt * speed;
      const mx = b.w / 2, my = b.h / 2;
      if (b.x < mx) { b.x = mx; b.vx = Math.abs(b.vx); }
      if (b.x > W - mx) { b.x = W - mx; b.vx = -Math.abs(b.vx); }
      if (b.y < my) { b.y = my; b.vy = Math.abs(b.vy); }
      if (b.y > H - my) { b.y = H - my; b.vy = -Math.abs(b.vy); }
      const t = now / 1000;
      const bob = Math.sin(t * 0.8 + b.phase) * 8;
      const rot = Math.sin(t * 0.5 + b.phase) * b.tilt;
      b.el.style.transform = `translate3d(${b.x - mx}px, ${b.y - my + bob}px, 0) rotate(${rot}deg)`;
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- Inhalte synchronisieren ---------------- */
  function addBubble(item, fresh) {
    const max = settings.wallMaxItems || 36;
    while (bubbles.size >= max) {
      const ids = [...bubbles.keys()];
      const victim = ids[Math.floor(Math.random() * ids.length)];
      bubbles.get(victim).remove();
      bubbles.delete(victim);
    }
    bubbles.set(item.id, new Bubble(item, fresh));
  }

  async function sync(highlightId) {
    const data = await api('/api/wall');
    const known = new Set(items.map((i) => i.id));
    items = data.items;
    const byId = new Map(items.map((i) => [i.id, i]));

    for (const [id, b] of bubbles) {
      const item = byId.get(id);
      // entfernt, oder Vorschaubild hat sich geändert -> neu aufbauen
      if (!item || item.thumb !== b.item.thumb) { b.remove(); bubbles.delete(id); }
    }
    if (current && !byId.has(current.id)) closeViewer();

    const max = settings.wallMaxItems || 36;
    const fresh = items.filter((i) => loaded && !known.has(i.id));
    for (const item of fresh) if (!bubbles.has(item.id)) addBubble(item, true);
    if (highlightId && !bubbles.has(highlightId) && byId.has(highlightId)) addBubble(byId.get(highlightId), true);

    const rest = items.filter((i) => !bubbles.has(i.id)).sort(() => Math.random() - 0.5);
    while (bubbles.size < max && rest.length) addBubble(rest.pop(), false);
    while (bubbles.size > max) {
      const id = bubbles.keys().next().value;
      bubbles.get(id).remove();
      bubbles.delete(id);
    }
    $('#empty').hidden = items.length > 0;
    loaded = true;
  }

  // Wenn es mehr Inhalte als Plätze gibt: regelmäßig durchwechseln
  setInterval(() => {
    if (current || items.length <= bubbles.size || !bubbles.size) return;
    const hidden = items.filter((i) => !bubbles.has(i.id));
    const next = hidden[Math.floor(Math.random() * hidden.length)];
    const ids = [...bubbles.keys()];
    const out = ids[Math.floor(Math.random() * ids.length)];
    bubbles.get(out).remove();
    bubbles.delete(out);
    bubbles.set(next.id, new Bubble(next, false));
  }, 9000);

  async function loadState() {
    const state = await api('/api/state');
    const sizeChanged = settings.thumbSize && settings.thumbSize !== state.settings.thumbSize;
    settings = state.settings;
    applyTheme(settings, state.backgroundUrl);
    $('#title').textContent = settings.title;
    $('#subtitle').textContent = settings.subtitle;
    document.title = settings.title;
    if (sizeChanged) { for (const b of bubbles.values()) b.el.remove(); bubbles.clear(); }
  }

  /* ---------------- Anzeige eines Inhalts ---------------- */
  function openViewer(item, auto = false) {
    closeViewer(true);
    if (!auto) lastInteraction = performance.now();
    current = item;
    viewerMedia.replaceChildren();
    $('#viewerTitle').textContent = item.title || '';
    viewerBar.style.transition = 'none';
    viewerBar.style.width = '0%';

    if (item.kind === 'video') {
      const video = el('video', { src: item.url, playsInline: true, autoplay: true, poster: item.thumb || '' });
      video.muted = !settings.videoSound;
      video.addEventListener('ended', () => closeViewer());
      video.addEventListener('error', () => closeViewer());
      video.addEventListener('timeupdate', () => {
        if (video.duration) viewerBar.style.width = (video.currentTime / video.duration * 100) + '%';
      });
      viewerMedia.append(video);
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    } else {
      const secs = settings.imageDuration || 8;
      viewerMedia.append(el('img', { src: item.url, alt: item.title || '' }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        viewerBar.style.transition = `width ${secs}s linear`;
        viewerBar.style.width = '100%';
      }));
      closeTimer = setTimeout(() => closeViewer(), secs * 1000);
    }
    viewer.hidden = false;
    requestAnimationFrame(() => viewer.classList.add('open'));
  }

  function closeViewer(instant = false) {
    clearTimeout(closeTimer);
    if (!current) return;
    current = null;
    lastInteraction = performance.now();
    const video = $('video', viewerMedia);
    if (video) video.pause();
    viewer.classList.remove('open');
    if (instant) { viewer.hidden = true; viewerMedia.replaceChildren(); return; }
    setTimeout(() => { if (!current) { viewer.hidden = true; viewerMedia.replaceChildren(); } }, 350);
  }

  viewer.addEventListener('click', (e) => {
    if (e.target === viewer || e.target.closest('#viewerClose')) closeViewer();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  stage.addEventListener('dblclick', (e) => { if (e.target === stage) toggleFullscreen(); });

  // Automatik: nach einer Weile ohne Bedienung zufällig einen Inhalt zeigen
  setInterval(() => {
    if (!settings.autoplay || current || !bubbles.size) return;
    if (performance.now() - lastInteraction < (settings.autoplayIdle || 25) * 1000) return;
    const list = [...bubbles.values()];
    openViewer(list[Math.floor(Math.random() * list.length)].item, true);
  }, 1000);

  // Mauszeiger ausblenden, wenn er nicht bewegt wird
  let cursorTimer;
  const wake = () => {
    lastInteraction = performance.now();
    document.body.classList.remove('idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, wake, { passive: true });

  /* ---------------- Start ---------------- */
  async function refresh(highlightId) {
    try { await loadState(); await sync(highlightId); } catch (e) { console.warn(e); }
  }
  connectEvents('wall', new URLSearchParams(location.search).get('name') || 'Wall', {
    items: (d) => refresh(d.added),
    settings: () => refresh(),
    reconnect: () => refresh(),
    command: (c) => {
      if (c.action === 'reload') location.reload();
      if (c.action === 'close') closeViewer();
      if (c.action === 'show') {
        const item = items.find((i) => i.id === c.id);
        if (item) openViewer(item, true);
      }
    },
  });
  refresh().then(() => requestAnimationFrame(tick));
  wake();
})();
