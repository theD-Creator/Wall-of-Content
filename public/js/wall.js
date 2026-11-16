'use strict';
/* Wall of Content – schwebende Kacheln mit Kollisionsphysik.
   Inhalte öffnen sich NUR durch Antippen/Klicken (oder per „Jetzt zeigen“ im Admin-Panel). */
(() => {
  const stage = $('#stage');
  const viewer = $('#viewer');
  const viewerMedia = $('#viewerMedia');
  const viewerBar = $('#viewerBar');
  const rand = (a, b) => a + Math.random() * (b - a);

  const GAP = 14;            // Mindestabstand zwischen Kacheln (deckt auch die leichte Drehung ab)
  const RESTITUTION = 0.9;   // Elastizität der Stöße (1 = perfekt elastisch)
  const MAX_STEP = 1 / 120;  // Physik-Teilschritt in Sekunden
  const PUSH_SPEED = 260;    // max. Geschwindigkeit, mit der Überlappungen aufgelöst werden (px/s)

  let settings = {};
  let items = [];              // alle Inhalte, die auf der Wall sein dürfen
  const bubbles = new Map();   // id -> Bubble (aktuell sichtbar)
  let loaded = false;
  let current = null;          // aktuell geöffneter Inhalt
  let closeTimer = null;

  /* ---------------- Kacheln ---------------- */
  function tileSize(item) {
    const scale = Math.min(innerWidth, innerHeight * 1.6) / 1728;
    const base = (settings.thumbSize || 200) * scale * rand(0.85, 1.2);
    const ratio = item.ratio ? item.ratio : item.kind === 'photo' ? 9 / 16 : item.kind === 'video' ? 16 / 10 : 1;
    const w = ratio >= 1 ? base * Math.sqrt(ratio) : base * ratio / Math.sqrt(ratio);
    return { w, h: w / ratio };
  }

  /** Überlappung zweier achsenparalleler Rechtecke (inkl. Abstand); <= 0 heißt frei. */
  function overlap(ax, ay, aw, ah, b) {
    const px = (aw + b.w) / 2 + GAP - Math.abs(b.x - ax);
    const py = (ah + b.h) / 2 + GAP - Math.abs(b.y - ay);
    return px > 0 && py > 0 ? Math.min(px, py) : 0;
  }

  /** Sucht einen freien Platz; sonst den mit der geringsten Überlappung. */
  function freeSpot(w, h, preferCenter) {
    const W = innerWidth, H = innerHeight;
    let best = null;
    for (let i = 0; i < 60; i++) {
      const spread = preferCenter ? Math.min(1, 0.15 + i / 40) : 1;
      const x = W / 2 + (Math.random() - 0.5) * (W - w) * spread;
      const y = H / 2 + (Math.random() - 0.5) * (H - h) * spread;
      let cost = 0;
      for (const b of bubbles.values()) cost += overlap(x, y, w, h, b);
      if (!best || cost < best.cost) best = { x, y, cost };
      if (cost === 0) break;
    }
    return best;
  }

  class Bubble {
    constructor(item, fresh) {
      this.item = item;
      Object.assign(this, tileSize(item));
      this.m = this.w * this.h;              // Masse ~ Fläche
      const spot = freeSpot(this.w, this.h, fresh);
      this.x = spot.x;
      this.y = spot.y;
      const dir = rand(0, Math.PI * 2);
      this.v = rand(16, 32);                 // Reisegeschwindigkeit in px/s
      this.vx = Math.cos(dir) * this.v;
      this.vy = Math.sin(dir) * this.v;
      this.phase = rand(0, Math.PI * 2);
      this.tilt = rand(1.5, 3.5);
      this.hover = false;

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
      this.el.addEventListener('pointerenter', () => { this.hover = true; });
      this.el.addEventListener('pointerleave', () => { this.hover = false; });
      stage.append(this.el);
      if (fresh) setTimeout(() => this.el.classList.remove('fresh'), 6000);
    }

    remove() {
      this.el.classList.add('leaving');
      setTimeout(() => this.el.remove(), 600);
    }
  }

  /* ---------------- Physik ---------------- */
  function step(list, dt, speed, t) {
    const W = innerWidth, H = innerHeight;

    for (const b of list) {
      // Reisegeschwindigkeit sanft wiederherstellen und Richtung leicht schlängeln lassen
      let s = Math.hypot(b.vx, b.vy);
      if (s < 0.01) { const d = rand(0, Math.PI * 2); b.vx = Math.cos(d); b.vy = Math.sin(d); s = 1; }
      const target = s + (b.v - s) * Math.min(1, dt * 0.7);
      const turn = Math.sin(t * 0.23 + b.phase) * 0.12 * dt;
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const nx = (b.vx * cos - b.vy * sin) / s, ny = (b.vx * sin + b.vy * cos) / s;
      b.vx = nx * target;
      b.vy = ny * target;

      const k = speed * (b.hover ? 0.12 : 1);
      b.x += b.vx * dt * k;
      b.y += b.vy * dt * k;

      // Ränder
      const mx = b.w / 2 + 4, my = b.h / 2 + 4;
      if (b.x < mx) { b.x = mx; b.vx = Math.abs(b.vx); }
      if (b.x > W - mx) { b.x = W - mx; b.vx = -Math.abs(b.vx); }
      if (b.y < my) { b.y = my; b.vy = Math.abs(b.vy); }
      if (b.y > H - my) { b.y = H - my; b.vy = -Math.abs(b.vy); }
    }

    // Stöße zwischen Kacheln (Rechtecke, Auflösung entlang der geringsten Überlappung)
    const maxPush = PUSH_SPEED * dt;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const px = (a.w + b.w) / 2 + GAP - Math.abs(dx);
        if (px <= 0) continue;
        const py = (a.h + b.h) / 2 + GAP - Math.abs(dy);
        if (py <= 0) continue;

        let nx = 0, ny = 0, pen;
        if (px < py) { nx = dx < 0 ? -1 : 1; pen = px; } else { ny = dy < 0 ? -1 : 1; pen = py; }
        const ia = a.hover ? 0 : 1 / a.m;   // eine Kachel unter dem Mauszeiger lässt sich nicht wegschubsen
        const ib = b.hover ? 0 : 1 / b.m;
        const sum = ia + ib;
        if (!sum) continue;

        // Überlappung weich auflösen (kein Springen)
        const push = Math.min(pen, maxPush) / sum;
        a.x -= nx * push * ia; a.y -= ny * push * ia;
        b.x += nx * push * ib; b.y += ny * push * ib;

        // Impuls nur, wenn sich die Kacheln aufeinander zu bewegen
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jImp = -(1 + RESTITUTION) * rv / sum;
          a.vx -= jImp * nx * ia; a.vy -= jImp * ny * ia;
          b.vx += jImp * nx * ib; b.vy += jImp * ny * ib;
        }
      }
    }
  }

  let lastT = performance.now();
  function tick(now) {
    const elapsed = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const speed = current ? 0.25 : (settings.speed ?? 1);
    const list = [...bubbles.values()];
    const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP));
    const t = now / 1000;
    for (let i = 0; i < steps; i++) step(list, elapsed / steps, speed, t);

    for (const b of list) {
      const rot = Math.sin(t * 0.5 + b.phase) * b.tilt;
      b.el.style.transform = `translate3d(${b.x - b.w / 2}px, ${b.y - b.h / 2}px, 0) rotate(${rot}deg)`;
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

  // Wenn es mehr Inhalte als Plätze gibt: regelmäßig eine Kachel austauschen (öffnet nichts)
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
    applyTheme(settings, state.backgroundUrl, state.logoUrl);
    $('#title').textContent = settings.title;
    $('#subtitle').textContent = settings.subtitle;
    document.title = settings.title;
    if (sizeChanged) { for (const b of bubbles.values()) b.el.remove(); bubbles.clear(); }
    renderHunt(state.hunt || {});
  }

  /* ---------------- Anzeige eines Inhalts (nur nach Klick) ---------------- */
  function openViewer(item) {
    closeViewer(true);
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

  /* ---------------- Color Hunt: QR-Code & Sieger ---------------- */
  let winnerKey = '';
  function renderHunt(hunt) {
    const qr = $('#huntQr');
    if (hunt.active && qr.hidden) $('img', qr).src = '/api/hunt/qr.svg?t=' + Date.now();
    qr.hidden = !hunt.active;

    const w = hunt.winner;
    const box = $('#winner');
    const key = w ? w.id + w.photos.join() : '';
    if (key === winnerKey) return;
    winnerKey = key;
    if (!w) {
      box.classList.remove('open');
      setTimeout(() => { if (!winnerKey) { box.hidden = true; $('#confetti').replaceChildren(); } }, 500);
      return;
    }
    closeViewer(true);
    box.style.setProperty('--hunt', w.color.hex);
    $('#winnerName').textContent = w.name;
    $('#winnerColor').textContent = w.color.name;
    $('#winnerPhotos').replaceChildren(...w.photos.map((src) => el('img', { src, alt: '' })));
    const colors = [w.color.hex, settings.accent || '#e10b70', '#ffffff', '#ffd23f'];
    $('#confetti').replaceChildren(...Array.from({ length: 90 }, (_, i) => {
      const c = el('i');
      c.style.left = rand(0, 100) + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = rand(0, 4) + 's';
      c.style.animationDuration = rand(3, 6) + 's';
      c.style.setProperty('--sway', rand(-80, 80) + 'px');
      return c;
    }));
    box.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('open')));
  }

  // Mauszeiger ausblenden, wenn er nicht bewegt wird
  let cursorTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, wake, { passive: true });

  // Fenstergröße geändert: Kacheln im Bild halten
  addEventListener('resize', () => {
    for (const b of bubbles.values()) {
      b.x = Math.min(Math.max(b.x, b.w / 2), innerWidth - b.w / 2);
      b.y = Math.min(Math.max(b.y, b.h / 2), innerHeight - b.h / 2);
    }
  });

  /* ---------------- Start ---------------- */
  async function refresh(highlightId) {
    try { await loadState(); await sync(highlightId); } catch (e) { console.warn(e); }
  }
  connectEvents('wall', new URLSearchParams(location.search).get('name') || 'Wall', {
    items: (d) => refresh(d.added),
    settings: () => refresh(),
    hunt: () => loadState().catch(() => {}),
    reconnect: () => refresh(),
    command: (c) => {
      if (c.action === 'reload') location.reload();
      if (c.action === 'close') closeViewer();
      if (c.action === 'show') {
        const item = items.find((i) => i.id === c.id);
        if (item) openViewer(item);
      }
    },
  });
  refresh().then(() => requestAnimationFrame(tick));
  wake();
})();
