'use strict';
/* Wall of Content – schwebende Kacheln mit Kollisionsphysik.
   Inhalte öffnen sich NUR durch Antippen/Klicken (oder per „Jetzt zeigen“ im Admin-Panel). */
(() => {
  const stage = $('#stage');
  const viewer = $('#viewer');
  const viewerMedia = $('#viewerMedia');
  const viewerBar = $('#viewerBar');
  const rand = (a, b) => a + Math.random() * (b - a);

  const GAP = 3;             // Kacheln berühren sich fast, bevor sie voneinander abprallen
  const RESTITUTION = 0.9;   // Elastizität der Stöße (1 = perfekt elastisch)
  const MAX_STEP = 1 / 120;  // Physik-Teilschritt in Sekunden
  const PUSH_SPEED = 260;    // max. Geschwindigkeit, mit der Überlappungen aufgelöst werden (px/s)

  // Verbund-Wall (experimentell): ?pos=N -> dieser Bildschirm ist Teil N einer großen Wall,
  // die Bewegung kommt dann vom Server statt aus der lokalen Physik.
  const params = new URLSearchParams(location.search);
  const gridPos = Math.max(0, parseInt(params.get('pos'), 10) || 0);
  const gridMode = gridPos > 0;
  let gridInfo = null;
  if (gridMode) { document.body.classList.add('grid-screen'); document.body.dataset.pos = gridPos; }
  let gridMissing = 0;

  let settings = {};
  let logoUrl = null;
  let items = [];              // alle Inhalte, die auf der Wall sein dürfen
  const bubbles = new Map();   // id -> Bubble (aktuell sichtbar)
  let loaded = false;
  let current = null;          // aktuell geöffneter Inhalt
  let closeTimer = null;

  /**
   * Gibt den Videoplayer eines <video> sofort frei. Ohne das bleiben entfernte Videos im Speicher,
   * bis der Browser aufräumt – Chrome erlaubt nur eine begrenzte Zahl gleichzeitiger Player
   * (Android ~40), danach spielen neue Videos einfach nicht mehr ab.
   */
  function releaseMedia(root) {
    const list = root instanceof HTMLVideoElement ? [root] : root ? [...root.querySelectorAll('video')] : [];
    for (const v of list) {
      if (v.dataset.keep) continue; // vorgeladenes Video aus dem Cache: nicht zerstören
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* egal */ }
    }
  }

  /* ---------------- Vorladen (Bilder & Videos) ---------------- */
  /**
   * Lädt die Inhalte der sichtbaren Kacheln im Hintergrund vor, damit sie beim Antippen sofort da sind.
   * Bilder landen im Browser-Cache, Videos bis zu einer Größengrenze komplett im Speicher (Blob);
   * größere Videos puffern in einem versteckten <video preload="auto">.
   */
  const Preload = (() => {
    const store = new Map(); // url -> { blob?, video?, img?, size, at }
    let queue = [];
    let running = false;
    let ctrl = null;
    let loadingUrl = null;
    const apple = /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const budget = (navigator.deviceMemory ? Math.min(900, navigator.deviceMemory * 80) : apple ? 160 : 450) * 1e6;
    const maxFile = Math.min(200e6, budget / 2);
    const MAX_BUFFER_EL = apple ? 1 : 3; // große Videos, die per <video preload=auto> puffern
    let bytes = 0;

    const enabled = () => settings.preloadMedia !== false;
    const busy = () => current && current.kind === 'video' && !ready(current); // Bandbreite fürs laufende Video lassen

    function ready(item) {
      const e = store.get(item.url);
      return !!(e && (e.blob || e.img || (e.video && e.video.readyState >= 3)));
    }
    function evict(needed, keep) {
      const order = [...store.entries()].filter(([u, e]) => e.blob && !keep.has(u)).sort((a, b) => a[1].at - b[1].at);
      for (const [u, e] of order) {
        if (bytes + needed <= budget) break;
        URL.revokeObjectURL(e.blob);
        bytes -= e.size;
        store.delete(u);
      }
      return bytes + needed <= budget;
    }
    function drop(url) {
      const e = store.get(url);
      if (!e) return;
      if (e.blob) { URL.revokeObjectURL(e.blob); bytes -= e.size; }
      if (e.video) { delete e.video.dataset.keep; releaseMedia(e.video); e.video.remove(); }
      store.delete(url);
    }

    async function loadImage(item) {
      const img = new Image();
      img.decoding = 'async';
      img.src = item.url;
      await img.decode();
      store.set(item.url, { img, size: 0, at: Date.now() });
    }
    async function loadVideo(item, keep) {
      ctrl = new AbortController();
      const res = await fetch(item.url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const size = Number(res.headers.get('content-length')) || 0;
      if (!size || size > maxFile || !evict(size, keep)) {
        ctrl.abort();
        // zu groß für den Speicher: in einem versteckten Video puffern lassen
        const buffered = [...store.values()].filter((e) => e.video);
        if (buffered.length >= MAX_BUFFER_EL) {
          const old = [...store.entries()].filter(([u, e]) => e.video && !keep.has(u)).sort((a, b) => a[1].at - b[1].at)[0];
          if (!old) return;
          drop(old[0]);
        }
        const v = el('video', { muted: true, playsInline: true, preload: 'auto', src: item.url });
        v.dataset.keep = '1';
        v.className = 'preload-video';
        document.body.append(v);
        store.set(item.url, { video: v, size: 0, at: Date.now() });
        return;
      }
      const blob = await res.blob();
      if (!evict(blob.size, keep)) return;
      bytes += blob.size;
      store.set(item.url, { blob: URL.createObjectURL(blob), size: blob.size, at: Date.now() });
    }

    async function run() {
      if (running) return;
      running = true;
      while (queue.length && enabled()) {
        if (busy() || document.hidden) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const item = queue.shift();
        if (store.has(item.url)) continue;
        const keep = new Set([...bubbles.values()].map((b) => b.item.url));
        if (current) keep.add(current.url); // was gerade läuft, bleibt im Speicher
        loadingUrl = item.url;
        try {
          if (item.kind === 'video') await loadVideo(item, keep);
          else await loadImage(item);
        } catch (e) {
          if (e.name === 'AbortError' && loadingUrl === item.url && queue.every((q) => q.url !== item.url) && bubbles.has(item.id)) queue.push(item);
        }
        loadingUrl = null;
        ctrl = null;
      }
      running = false;
    }

    return {
      /** Liste in Priorität: sichtbare Kacheln zuerst, Bilder vor Videos. */
      want(list) {
        const urls = new Set(items.map((i) => i.url));
        for (const u of [...store.keys()]) if (!urls.has(u)) drop(u); // nicht mehr auf der Wall
        if (!enabled()) { for (const u of [...store.keys()]) drop(u); queue = []; return; }
        queue = [...list.filter((i) => i.kind !== 'video'), ...list.filter((i) => i.kind === 'video')].filter((i) => !store.has(i.url));
        run();
      },
      /** Quelle zum Abspielen: vorgeladener Blob, gepuffertes Video-Element oder die normale Adresse. */
      source(item) {
        const e = store.get(item.url);
        if (e) e.at = Date.now();
        return e ? { blob: e.blob, video: e.video } : {};
      },
      /** Beim Öffnen eines nicht vorgeladenen Videos: laufenden Download abbrechen. */
      yield(item) { if (ctrl && loadingUrl !== item.url) ctrl.abort(); },
      forget: drop,
      stats: () => ({ files: store.size, mb: Math.round(bytes / 1e6) }),
    };
  })();

  function preloadVisible() {
    if (gridMode || layout) return Preload.want(items.slice(0, settings.wallMaxItems || 36));
    const visible = [...bubbles.values()].map((b) => b.item);
    const rest = items.filter((i) => !bubbles.has(i.id));
    Preload.want([...visible, ...rest]);
  }

  /* ---------------- Hitboxen: Titel, QR-Codes, Logo, Rangliste ---------------- */
  /**
   * Feste Hindernisse für die Physik. Beim Text zählt nur die tatsächliche Schrift
   * (pro Zeile, Höhe aus den Glyphen-Maßen), nicht der ganze Kopfbereich.
   */
  let obstacles = [];
  let obstaclesAt = 0;
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textRects(node) {
    if (!node || !node.textContent.trim() || !node.getClientRects().length) return [];
    const cs = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = measureCtx.measureText(node.textContent.trim());
    const fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent;
    const aa = m.actualBoundingBoxAscent, ad = m.actualBoundingBoxDescent;
    return rects.map((r) => {
      if (!(fa > 0 && aa > 0)) return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      // Grundlinie innerhalb der Zeilenbox finden und auf die echte Schrifthöhe zuschneiden
      const k = r.height / (fa + fd);
      const base = r.top + fa * k;
      return { l: r.left, t: Math.max(r.top, base - aa * k), r: r.right, b: Math.min(r.bottom, base + ad * k) };
    });
  }
  function measureObstacles() {
    const pad = 5;
    const out = [];
    const add = (r, p = pad) => { if (r.r - r.l > 0 && r.b - r.t > 0) out.push({ l: r.l - p, t: r.t - p, r: r.r + p, b: r.b + p }); };
    if (!document.body.classList.contains('grid-screen') || gridPos === 1) {
      for (const r of textRects($('#title'))) add(r);
      for (const r of textRects($('#subtitle'))) add(r);
    }
    for (const n of $$('.qr-stack > .hunt-qr, #board, .wall-logo')) {
      if (n.hidden || !n.getClientRects().length) continue;
      const r = n.getBoundingClientRect();
      add({ l: r.left, t: r.top, r: r.right, b: r.bottom }, 4);
    }
    // Lücken, in die keine Kachel passt (zum Rand oder zwischen zwei Hindernissen), mit füllen
    const sizes = [...bubbles.values()].map((b) => Math.min(b.w, b.h));
    const minTile = (sizes.length ? Math.min(...sizes) : 60) + 2 * GAP;
    const W = innerWidth, H = innerHeight;
    for (const o of out) {
      if (o.t < minTile) o.t = -9999;
      if (H - o.b < minTile) o.b = H + 9999;
      if (o.l < minTile) o.l = -9999;
      if (W - o.r < minTile) o.r = W + 9999;
    }
    const bridges = [];
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue;
        const a = out[i], b = out[j];
        const gy = b.t - a.b, gx = b.l - a.r;
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (gy > 0 && gy < minTile && ox > 0) bridges.push({ l: Math.max(a.l, b.l), r: Math.min(a.r, b.r), t: a.b, b: b.t });
        if (gx > 0 && gx < minTile && oy > 0) bridges.push({ l: a.r, r: b.l, t: Math.max(a.t, b.t), b: Math.min(a.b, b.b) });
      }
    }
    obstacles = out.concat(bridges);
    obstaclesAt = performance.now();
  }
  const obstacleCost = (x, y, w, h) => {
    let cost = 0;
    for (const o of obstacles) {
      const px = Math.min(x + w / 2 + GAP - o.l, o.r - (x - w / 2 - GAP));
      const py = Math.min(y + h / 2 + GAP - o.t, o.b - (y - h / 2 - GAP));
      if (px > 0 && py > 0) cost += Math.min(px, py) * 4;
    }
    return cost;
  };

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
    for (let i = 0; i < 80; i++) {
      const spread = preferCenter ? Math.min(1, 0.15 + i / 40) : 1;
      const x = W / 2 + (Math.random() - 0.5) * (W - w) * spread;
      const y = H / 2 + (Math.random() - 0.5) * (H - h) * spread;
      let cost = obstacleCost(x, y, w, h);
      for (const b of bubbles.values()) cost += overlap(x, y, w, h, b);
      if (!best || cost < best.cost) best = { x, y, cost };
      if (cost === 0) break;
    }
    return best;
  }

  class Bubble {
    constructor(item, fresh, geo) {
      this.item = item;
      Object.assign(this, geo || tileSize(item));
      this.m = this.w * this.h;              // Masse ~ Fläche
      this.bump = 0;
      const spot = geo || freeSpot(this.w, this.h, fresh);
      this.x = spot.x;
      this.y = spot.y;
      const dir = rand(0, Math.PI * 2);
      this.v = rand(16, 32);                 // Reisegeschwindigkeit in px/s
      this.vx = Math.cos(dir) * this.v;
      this.vy = Math.sin(dir) * this.v;
      this.phase = rand(0, Math.PI * 2);
      this.tilt = rand(1.5, 3.5);
      this.hover = false;

      const media = item.kind === 'video'
        ? VideoPreview.make(item)
        : el('img', { src: item.thumb || item.url, alt: '', draggable: false, decoding: 'async' });
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
      setTimeout(() => { releaseMedia(this.el); this.el.remove(); }, 600);
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
          if (rv < -6) a.bump = b.bump = performance.now(); // kurzes Aufleuchten beim Zusammenstoß
          const jImp = -(1 + RESTITUTION) * rv / sum;
          a.vx -= jImp * nx * ia; a.vy -= jImp * ny * ia;
          b.vx += jImp * nx * ib; b.vy += jImp * ny * ib;
        }
      }
    }

    // Feste Hindernisse (Titel, QR-Codes, Logo): Kachel prallt ab, Hindernis bewegt sich nie
    for (const b of list) {
      for (const o of obstacles) {
        const hw = b.w / 2 + GAP, hh = b.h / 2 + GAP;
        const pl = b.x + hw - o.l, pr = o.r - (b.x - hw);
        if (pl <= 0 || pr <= 0) continue;
        const pt = b.y + hh - o.t, pb = o.b - (b.y - hh);
        if (pt <= 0 || pb <= 0) continue;
        const px = Math.min(pl, pr), py = Math.min(pt, pb);
        if (px < py) {
          const dir = pl < pr ? -1 : 1;
          b.x += dir * Math.min(px, maxPush * 2);
          if (b.vx * dir < 0) b.vx = -b.vx;
        } else {
          const dir = pt < pb ? -1 : 1;
          b.y += dir * Math.min(py, maxPush * 2);
          if (b.vy * dir < 0) b.vy = -b.vy;
        }
      }
    }
  }

  /* ---------------- Verbund-Wall: Positionen vom Server ---------------- */
  function onGrid(g) {
    gridInfo = g;
    const now = performance.now();
    const byId = new Map(items.map((i) => [i.id, i]));
    const seen = new Set();
    let missing = false;
    for (const [id, x, y, w, h, vx, vy, phase] of g.tiles) {
      const item = byId.get(id);
      if (!item) { missing = true; continue; }
      seen.add(id);
      let b = bubbles.get(id);
      if (b && (Math.abs(b.gw - w) > 1 || b.item.thumb !== item.thumb)) { releaseMedia(b.el); b.el.remove(); bubbles.delete(id); b = null; }
      if (!b) {
        b = new Bubble(item, false, { w, h, x, y });
        b.gw = w;
        b.dx = x; b.dy = y;
        bubbles.set(id, b);
      }
      Object.assign(b, { sx: x, sy: y, vx, vy, phase, at: now });
    }
    for (const [id, b] of bubbles) if (!seen.has(id)) { b.remove(); bubbles.delete(id); }
    // unbekannte Inhalte nachladen (höchstens alle 3 s)
    if (missing && now - gridMissing > 3000) { gridMissing = now; refresh(); }
  }

  function renderGrid(now) {
    const g = gridInfo;
    if (!g) return;
    const scale = Math.min(innerWidth / g.sw, innerHeight / g.sh);
    const index = Math.min(gridPos, g.cols * g.rows) - 1;
    const ox = (index % g.cols) * g.sw - (innerWidth / scale - g.sw) / 2;
    const oy = Math.floor(index / g.cols) * g.sh - (innerHeight / scale - g.sh) / 2;
    const t = now / 1000;
    for (const b of bubbles.values()) {
      // Position zwischen zwei Server-Meldungen weiterrechnen und weich angleichen
      const age = Math.min(0.5, (now - b.at) / 1000);
      const px = b.sx + b.vx * age, py = b.sy + b.vy * age;
      b.dx += (px - b.dx) * 0.25;
      b.dy += (py - b.dy) * 0.25;
      const x = (b.dx - b.w / 2 - ox) * scale, y = (b.dy - b.h / 2 - oy) * scale;
      const w = b.w * scale, h = b.h * scale;
      const visible = x + w > -40 && x < innerWidth + 40 && y + h > -40 && y < innerHeight + 40;
      if (b.visible !== visible) { b.visible = visible; b.el.style.display = visible ? '' : 'none'; }
      if (!visible) continue;
      if (b.scale !== scale) { b.scale = scale; b.el.style.width = w + 'px'; b.el.style.height = h + 'px'; }
      const rot = Math.sin(t * 0.5 + b.phase) * 2.5;
      b.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
    }
  }

  let lastT = performance.now();
  /* ---------------- Neues Design: Bühne / Mosaik (public/js/wall-layouts.js) ---------------- */
  let layout = null;
  let layoutKind = '';
  let program = [];
  let serverOffset = 0;
  function applyLayout() {
    const design = applyDesign(settings);
    // „schweben“: schwebende Kacheln (klassisches Prinzip) im neuen Look – also kein Bühne/Mosaik-Layout
    const kind = gridMode || design !== 'neu' || !window.WallLayouts || settings.wallLayout === 'schweben' ? '' : (settings.wallLayout || 'buehne');
    if (kind !== layoutKind) {
      if (layout) { layout.destroy(); layout = null; }
      layoutKind = kind;
      document.body.classList.toggle('layout-on', !!kind);
      if (kind) {
        for (const b of bubbles.values()) { releaseMedia(b.el); b.el.remove(); }
        bubbles.clear();
        layout = WallLayouts.mount(kind, $('#layout'), { open: (item) => openViewer(item), now: () => Date.now() + serverOffset });
        layout.settings(settings, program, logoUrl);
        layout.update(items, {});
        if (current) layout.pause(true);
      } else if (loaded) {
        sync().catch(() => {}); // zurück zu den schwebenden Kacheln
      }
      return;
    }
    if (layout) layout.settings(settings, program, logoUrl);
  }

  function tick(now) {
    requestAnimationFrame(tick);
    const elapsed = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (dvd.on) { dvdFrame(elapsed); return; } // Wall ist verdeckt: Physik ruht
    if (layout) return; // Bühne/Mosaik animieren selbst
    // Während ein Inhalt groß gezeigt wird, steht die Wall still: Video bekommt die volle Leistung
    if (current && viewer.classList.contains('open') && now - openedAt > 500) return;
    if (gridMode) { renderGrid(now); return; }
    if (now - obstaclesAt > 500) measureObstacles();
    const speed = current ? 0.25 : (settings.speed ?? 1);
    const list = [...bubbles.values()];
    const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP));
    const t = now / 1000;
    for (let i = 0; i < steps; i++) step(list, elapsed / steps, speed, t);

    for (const b of list) {
      const rot = Math.sin(t * 0.5 + b.phase) * b.tilt;
      b.el.style.transform = `translate3d(${b.x - b.w / 2}px, ${b.y - b.h / 2}px, 0) rotate(${rot}deg)`;
      const bumped = now - b.bump < 260;
      if (bumped !== b.bumped) { b.bumped = bumped; b.el.classList.toggle('bump', bumped); }
    }
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
    if (gridMode) {
      if (current && !byId.has(current.id)) closeViewer();
      $('#empty').hidden = items.length > 0;
      loaded = true;
      preloadVisible();
      return;
    }
    if (layout) {
      if (current && !byId.has(current.id)) closeViewer();
      const fresh = loaded ? items.filter((i) => !known.has(i.id)).map((i) => i.id) : [];
      if (highlightId && byId.has(highlightId) && !fresh.includes(highlightId)) fresh.push(highlightId);
      if (fresh.length) activity(); // neuer Inhalt weckt die Wall auf
      layout.update(items, { fresh });
      $('#empty').hidden = items.length > 0;
      loaded = true;
      preloadVisible();
      return;
    }

    for (const [id, b] of bubbles) {
      const item = byId.get(id);
      // entfernt, oder Vorschaubild hat sich geändert -> neu aufbauen
      if (!item || item.thumb !== b.item.thumb) { b.remove(); bubbles.delete(id); }
    }
    if (current && !byId.has(current.id)) closeViewer();

    const max = settings.wallMaxItems || 36;
    const fresh = items.filter((i) => loaded && !known.has(i.id));
    if (fresh.length) activity(); // neuer Inhalt weckt die Wall auf
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
    measureObstacles();
    preloadVisible();
  }

  // Wenn es mehr Inhalte als Plätze gibt: regelmäßig eine Kachel austauschen (öffnet nichts)
  setInterval(() => {
    if (gridMode || layout || current || dvd.on || items.length <= bubbles.size || !bubbles.size) return;
    const hidden = items.filter((i) => !bubbles.has(i.id));
    if (!hidden.length) return;
    const next = hidden[Math.floor(Math.random() * hidden.length)];
    const ids = [...bubbles.keys()];
    const out = ids[Math.floor(Math.random() * ids.length)];
    bubbles.get(out).remove();
    bubbles.delete(out);
    bubbles.set(next.id, new Bubble(next, false));
    preloadVisible();
  }, 9000);

  let qrKey = '';
  async function loadState() {
    const state = await api('/api/state');
    const sizeChanged = settings.thumbSize && settings.thumbSize !== state.settings.thumbSize;
    const prev = settings;
    settings = state.settings;
    logoUrl = state.logoUrl;
    applyTheme(settings, state.backgroundUrl, state.logoUrl);
    $('#title').textContent = settings.title;
    $('#subtitle').textContent = settings.subtitle;
    document.title = settings.title;
    document.documentElement.style.setProperty('--qr-scale', (settings.qrSize || 100) / 100);
    if (sizeChanged && !gridMode) { for (const b of bubbles.values()) { releaseMedia(b.el); b.el.remove(); } bubbles.clear(); }
    renderHunt(state.hunt || {});
    renderNowPlaying(state.nowPlaying, state.nowPlayingV);
    renderObs(state.obs);
    renderBoard((state.quiz || {}).board);
    const portal = $('#portalQr');
    // QR-Codes neu holen, wenn sie erscheinen oder sich die Einstellungen geändert haben (z. B. öffentliche Adresse)
    const key = String(state.settingsVersion || '');
    if (settings.portalQr && (portal.hidden || key !== qrKey)) $('img', portal).src = '/api/v/qr.svg?t=' + Date.now();
    if (state.hunt && state.hunt.active && key !== qrKey) $('img', $('#huntQr')).src = '/api/hunt/qr.svg?t=' + Date.now();
    qrKey = key;
    portal.hidden = !settings.portalQr;
    if (prev.dvdMode && !settings.dvdMode && dvd.on && !dvd.manual) stopDvd();
    if (dvd.on) dvdPrepare();
    program = state.program || [];
    if (state.now) serverOffset = state.now - Date.now();
    applyLayout();
    measureObstacles();
  }

  /* ---------------- Anzeige eines Inhalts (nur nach Klick) ---------------- */
  let openedAt = 0;
  const viewerSpin = $('#viewerSpin');
  const viewerMsg = $('#viewerMsg');
  const viewerSound = $('#viewerSound');

  function viewerError(text) {
    viewerSpin.hidden = true;
    viewerMsg.textContent = text;
    viewerMsg.hidden = false;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeViewer(), 5000);
  }

  function openViewer(item) {
    activity();
    closeViewer(true);
    if (layout) layout.pause(true); // Bühne/Mosaik halten an, solange der Inhalt groß gezeigt wird
    VideoPreview.pause(true); // Vorschau-Videos aus, damit das große Video die volle Leistung hat
    current = item;
    openedAt = performance.now();
    viewerMedia.replaceChildren();
    viewerMsg.hidden = true;
    viewerSound.hidden = true;
    viewerSound.textContent = '🔇 Tippen für Ton';
    viewerSpin.hidden = true;
    $('#viewerTitle').textContent = item.title || '';
    viewerBar.style.transition = 'none';
    viewerBar.style.width = '0%';

    const qr = $('#viewerQr');
    qr.hidden = !settings.viewerQr || gridMode;
    if (!qr.hidden) $('img', qr).src = `/api/items/${encodeURIComponent(item.id)}/qr.svg`;

    if (item.kind === 'video') {
      const pre = Preload.source(item);
      if (!pre.blob && !pre.video) Preload.yield(item);
      let video;
      if (pre.video) {
        video = pre.video; // schon gepuffert: direkt weiterverwenden
        video.className = '';
        video.currentTime = 0;
      } else {
        video = el('video', { src: pre.blob || item.url, playsInline: true, preload: 'auto', poster: item.thumb || undefined });
      }
      video.muted = !settings.videoSound;
      let fellBack = !pre.blob;
      video.onended = () => closeViewer();
      video.onerror = () => {
        if (current !== item) return;
        if (!fellBack) { fellBack = true; video.src = item.url; video.play().catch(() => {}); return; } // Blob kaputt: direkt vom Server
        viewerError('Dieses Video lässt sich hier nicht abspielen. Meist liegt es am Format (z. B. HEVC/H.265 aus dem iPhone) – im Admin-Panel als MP4 (H.264) hochladen.');
      };
      video.onwaiting = () => { if (current === item) viewerSpin.hidden = false; };
      video.onplaying = () => { viewerSpin.hidden = true; };
      video.ontimeupdate = () => {
        if (video.duration && Number.isFinite(video.duration)) viewerBar.style.width = (video.currentTime / video.duration * 100) + '%';
      };
      viewerMedia.append(video);
      if (video.readyState < 3) viewerSpin.hidden = false;
      const tryPlay = () => video.play().catch((e) => {
        if (current !== item || e.name !== 'NotAllowedError') return;
        // Autoplay mit Ton blockiert (z. B. bei „Jetzt zeigen“ aus dem Admin-Panel): stumm starten, Ton per Tipp
        video.muted = true;
        viewerSound.hidden = !settings.videoSound;
        video.play().catch(() => { viewerSpin.hidden = true; viewerSound.hidden = false; viewerSound.textContent = '▶ Tippen zum Abspielen'; });
      });
      tryPlay();
      viewerSound.onclick = (e) => {
        e.stopPropagation();
        video.muted = !settings.videoSound ? video.muted : false;
        video.play().catch(() => {});
        viewerSound.hidden = true;
      };
    } else {
      const secs = settings.imageDuration || 8;
      const img = el('img', { src: item.url, alt: item.title || '' });
      img.onerror = () => { if (current === item) viewerError('Das Bild konnte nicht geladen werden.'); };
      viewerMedia.append(img);
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
    if (layout) layout.pause(false);
    VideoPreview.pause(false);
    activity();
    const video = $('video', viewerMedia);
    if (video) {
      video.pause();
      video.onended = video.onerror = video.onwaiting = video.onplaying = video.ontimeupdate = null;
      if (video.dataset.keep) { // gepuffertes Video zurück ins Versteck
        video.className = 'preload-video';
        document.body.append(video);
      }
    }
    viewer.classList.remove('open');
    const cleanup = () => { releaseMedia(viewerMedia); viewerMedia.replaceChildren(); viewerSpin.hidden = true; viewerMsg.hidden = true; viewerSound.hidden = true; };
    if (instant) { viewer.hidden = true; cleanup(); return; }
    setTimeout(() => { if (!current) { viewer.hidden = true; cleanup(); } }, 350);
  }

  viewer.addEventListener('click', (e) => {
    if (e.target === viewer || e.target.closest('#viewerClose')) closeViewer();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });
  stage.addEventListener('dblclick', (e) => { if (e.target === stage) Fullscreen.toggle(); });

  /* ---------------- Color Hunt: QR-Code & Sieger ---------------- */
  let winnerKey = '';
  let huntClock = { active: false, endsAt: null, offset: 0 };
  const clockText = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  /** Countdown der Challenge: im QR-Kasten, die letzten 10 Sekunden groß in der Mitte. */
  function updateHuntClock() {
    const cd = $('#huntCountdown');
    const fin = $('#huntFinal');
    const { active, endsAt, offset } = huntClock;
    if (!endsAt) { cd.hidden = true; fin.hidden = true; return; }
    const left = endsAt - (Date.now() + offset);
    const s = Math.max(0, Math.ceil(left / 1000));
    cd.hidden = !active || left <= 0;
    cd.textContent = `⏳ ${clockText(s)}`;
    cd.classList.toggle('urgent', s <= 60);
    let text = '';
    if (left > 0 && s <= 10 && active) text = String(s);
    else if (left <= 0 && left > -6000) text = 'Zeit ist um!';
    fin.hidden = !text;
    if (text) activity(); // der Schlussspurt soll zu sehen sein
    if (text && fin.textContent !== text) {
      fin.textContent = text;
      fin.classList.toggle('over', left <= 0);
      fin.classList.remove('pop');
      void fin.offsetWidth;
      fin.classList.add('pop');
    }
  }
  setInterval(updateHuntClock, 200);

  function renderHunt(hunt) {
    huntClock = { active: !!hunt.active, endsAt: hunt.endsAt || null, offset: (hunt.now || Date.now()) - Date.now() };
    updateHuntClock();
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
    activity();
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

  /* ---------------- „Läuft gerade“: Schallplatte mit Songtitel ---------------- */
  let npKey = '';
  let npSong = null;
  let npV = 0; // Version der Meldung: Live-Ereignis und /api/state können sich überholen – die neuere gewinnt
  function renderNowPlaying(song, v) {
    if (v === undefined || v >= npV) { npSong = song; if (v !== undefined) npV = v; }
    song = npSong;
    const box = $('#nowPlaying');
    const show = !!(settings.nowPlaying && song && song.title);
    const key = show ? `${song.artist}|${song.title}` : '';
    if (!show) { box.hidden = true; npKey = ''; return; }
    if (key !== npKey) {
      npKey = key;
      $('#npTitle').textContent = song.title;
      $('#npArtist').textContent = song.artist || '';
      const img = $('#npCover');
      img.hidden = !song.coverUrl;
      if (song.coverUrl) img.src = song.coverUrl; else img.removeAttribute('src');
      box.classList.remove('swap');
      void box.offsetWidth;
      box.classList.add('swap'); // neuer Song: Platte „wird aufgelegt“
    }
    box.classList.toggle('paused', !song.playing);
    box.hidden = false;
  }

  /* ---------------- OBS-Livestream ---------------- */
  /**
   * Solange OBS an die Wall streamt, läuft das Bild – je nach Einstellung groß über der Wall, auf der Bühne
   * (im Mosaik in der ersten Kachel) oder als Bild-im-Bild. Wiedergabe als HTTP-FLV mit mpegts.js.
   */
  const obs = { state: { live: false }, player: null, retry: null, box: $('#obsLive'), video: $('#obsVideo') };
  function obsTarget() {
    if (settings.obsDisplay !== 'buehne' || !layout) return null;
    return document.querySelector('.L-buehne .lb-stage') || document.querySelector('.L-mosaik .lm-tile');
  }
  function placeObs() {
    const target = obsTarget();
    const parent = target || document.body;
    if (obs.box.parentNode !== parent) {
      parent.append(obs.box);
      obs.video.play().catch(() => {});
    }
    obs.box.className = 'obs-live ' + (target ? 'in-stage' : settings.obsDisplay === 'pip' ? 'pip' : 'full');
  }
  function stopObs() {
    if (!obs.player) return;
    try { obs.player.pause(); obs.player.unload(); obs.player.detachMediaElement(); obs.player.destroy(); } catch { /* schon weg */ }
    obs.player = null;
  }
  function startObs() {
    if (obs.player || !window.mpegts || !mpegts.getFeatureList().mseLivePlayback) return;
    const p = mpegts.createPlayer({ type: 'flv', isLive: true, url: '/api/obs/live.flv' }, {
      enableStashBuffer: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 2.5, liveBufferLatencyMinRemain: 0.4,
    });
    p.on(mpegts.Events.ERROR, () => { // Verbindung weg: kurz warten und neu verbinden, solange der Stream läuft
      stopObs();
      clearTimeout(obs.retry);
      obs.retry = setTimeout(() => renderObs(), 2000);
    });
    p.attachMediaElement(obs.video);
    p.load();
    obs.player = p;
    const r = p.play();
    if (r && r.catch) r.catch(() => { obs.video.muted = true; p.play(); }); // Ton ohne Berührung nicht erlaubt
  }
  function renderObs(st) {
    if (st) obs.state = st;
    const on = !!(settings.obsShow && obs.state.live && !gridMode);
    document.body.classList.toggle('obs-on', on);
    if (!on) { clearTimeout(obs.retry); stopObs(); obs.box.hidden = true; return; }
    obs.video.muted = !settings.obsSound;
    placeObs();
    obs.box.hidden = false;
    startObs();
    activity();
  }
  setInterval(() => { if (!obs.box.hidden) placeObs(); }, 1000); // Bühne/Mosaik werden neu aufgebaut (Wechsel)

  /* ---------------- Quiz: Rangliste auf der Wall ---------------- */
  function renderBoard(board) {
    const box = $('#board');
    box.hidden = !board;
    if (!board) return;
    $('#boardList').replaceChildren(...(board.length
      ? board.map((b) => el('li', {}, el('span', { class: 'rank', text: b.rank }), el('b', { text: b.name }), el('span', { class: 'pts', text: b.score })))
      : [el('li', { class: 'muted', text: 'Noch keine Ergebnisse' })]));
  }

  /* ---------------- DVD-Logo-Bildschirmschoner ---------------- */
  /**
   * Nach Inaktivität fliegt das Logo wie beim alten DVD-Player über den Bildschirm und wechselt bei
   * jedem Aufprall die Farbe. Im Ecken-Modus wird jede Strecke so berechnet, dass das Logo genau
   * in der nächsten Ecke ankommt: oben links → oben rechts → unten rechts → unten links → …
   * (mit 1–5 Abprallern dazwischen, damit es natürlich aussieht).
   */
  const dvd = { on: false, manual: false, el: $('#dvd'), logo: $('#dvdLogo'), x: 0, y: 0, vx: 0, vy: 0, w: 0, h: 0, leg: null, ratio: 3.89, color: 0, corners: 0 };
  const DVD_COLORS = ['#ff2d55', '#ffcc00', '#34c759', '#00c7ff', '#af52de', '#ff9500', '#ffffff', '#ff6bd6'];
  let lastActivity = Date.now();

  function activity() {
    lastActivity = Date.now();
    if (dvd.on) stopDvd();
  }
  function dvdColor() {
    let n;
    do { n = Math.floor(Math.random() * DVD_COLORS.length); } while (n === dvd.color);
    dvd.color = n;
    dvd.logo.style.setProperty('--dvd', DVD_COLORS[n]);
  }
  function dvdPrepare() {
    if (logoUrl) {
      dvd.logo.classList.add('masked');
      dvd.logo.style.webkitMaskImage = dvd.logo.style.maskImage = `url("${logoUrl}")`;
      if (dvd.ratioUrl !== logoUrl) {
        dvd.ratioUrl = logoUrl;
        dvd.crop = null;
        const img = new Image();
        img.onload = () => {
          if (!img.naturalWidth || !img.naturalHeight) return;
          dvd.crop = dvdBounds(img);
          const c = dvd.crop;
          dvd.ratio = (img.naturalWidth * c.w) / (img.naturalHeight * c.h);
          dvdResize();
        };
        img.src = logoUrl;
      }
    } else {
      dvd.logo.classList.remove('masked');
    }
    dvdResize();
  }
  /**
   * Sichtbarer Bereich des Logos (ohne durchsichtigen Rand) als Anteil 0–1. Viele Logo-Dateien haben leeren Rand –
   * ohne diese Korrektur prallt das Logo sichtbar zu früh ab und trifft die Ecken nicht.
   */
  function dvdBounds(img) {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    try {
      const W = 600, H = Math.max(1, Math.round(600 * img.naturalHeight / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      const a = g.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (a[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) return full;
      return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
    } catch { return full; }
  }
  function dvdResize() {
    const W = innerWidth, H = innerHeight;
    const w = Math.max(140, Math.min(W * 0.26, 520, H * 0.4 * dvd.ratio));
    dvd.w = w;
    dvd.h = dvd.logo.classList.contains('masked') ? w / dvd.ratio : dvd.logo.getBoundingClientRect().height || w / 4;
    dvd.logo.style.width = w + 'px';
    dvd.logo.style.height = dvd.logo.classList.contains('masked') ? dvd.h + 'px' : '';
    const c = dvd.logo.classList.contains('masked') && dvd.crop;
    if (c) {
      // Maske so vergrößern/verschieben, dass der sichtbare Teil genau die Box füllt
      const mw = dvd.w / c.w, mh = dvd.h / c.h;
      dvd.logo.style.webkitMaskSize = dvd.logo.style.maskSize = `${mw}px ${mh}px`;
      dvd.logo.style.webkitMaskPosition = dvd.logo.style.maskPosition = `${-c.x * mw}px ${-c.y * mh}px`;
    } else {
      dvd.logo.style.webkitMaskSize = dvd.logo.style.maskSize = '';
      dvd.logo.style.webkitMaskPosition = dvd.logo.style.maskPosition = '';
    }
    dvd.x = Math.min(Math.max(0, dvd.x), W - dvd.w);
    dvd.y = Math.min(Math.max(0, dvd.y), H - dvd.h);
    if (dvd.on && settings.dvdCorners) dvdLeg(true);
  }
  const dvdSpeed = () => Math.min(innerWidth, innerHeight) * 0.16 * (settings.dvdSpeed || 1);
  const fold = (u, L) => {
    if (L <= 0) return 0;
    const p = ((u % (2 * L)) + 2 * L) % (2 * L);
    return p <= L ? p : 2 * L - p;
  };
  /** Nächste Strecke im Ecken-Modus. `direct` = von der aktuellen Position gerade in die Ziel-Ecke. */
  function dvdLeg(direct) {
    const Wr = Math.max(1, innerWidth - dvd.w), Hr = Math.max(1, innerHeight - dvd.h);
    const corners = [[0, 0], [Wr, 0], [Wr, Hr], [0, Hr]];
    let dx, dy, target;
    if (direct || !dvd.leg) {
      // nächstgelegene Ecke als Start der Runde
      target = dvd.leg && direct ? dvd.leg.target : corners.map((c, i) => [Math.hypot(c[0] - dvd.x, c[1] - dvd.y), i]).sort((a, b) => a[0] - b[0])[0][1];
      dx = corners[target][0] - dvd.x;
      dy = corners[target][1] - dvd.y;
    } else {
      const from = dvd.leg.target;
      target = (from + 1) % 4;
      // Abpraller dazwischen: Winkel zwischen 22° und 68° bevorzugen
      const options = [1, 2, 3].map((m) => {
        const v = [[Wr, 2 * m * Hr], [-2 * m * Wr, Hr], [-Wr, -2 * m * Hr], [2 * m * Wr, -Hr]][from];
        const ang = Math.atan2(Math.abs(v[1]), Math.abs(v[0])) * 180 / Math.PI;
        return { v, ang };
      });
      const good = options.filter((o) => o.ang >= 22 && o.ang <= 68);
      const pick = good.length ? good[Math.floor(Math.random() * good.length)] : options.sort((a, b) => Math.abs(a.ang - 45) - Math.abs(b.ang - 45))[0];
      [dx, dy] = pick.v;
    }
    const dist = Math.hypot(dx, dy);
    dvd.leg = { x0: dvd.x, y0: dvd.y, dx, dy, T: Math.max(0.05, dist / dvdSpeed()), t: 0, target, bx: 0, by: 0 };
  }
  function dvdHit(corner) {
    dvdColor();
    if (!corner) return;
    dvd.corners++;
    dvd.el.classList.remove('corner');
    void dvd.el.offsetWidth;
    dvd.el.classList.add('corner');
  }
  function dvdFrame(dt) {
    const Wr = Math.max(0, innerWidth - dvd.w), Hr = Math.max(0, innerHeight - dvd.h);
    if (settings.dvdCorners) {
      if (!dvd.leg) dvdLeg(true);
      const L = dvd.leg;
      L.t += dt;
      const s = Math.min(1, L.t / L.T);
      const ux = L.x0 + L.dx * s, uy = L.y0 + L.dy * s;
      dvd.x = fold(ux, Wr);
      dvd.y = fold(uy, Hr);
      const bx = Wr ? Math.floor(ux / Wr + 1e-9) : 0, by = Hr ? Math.floor(uy / Hr + 1e-9) : 0;
      if (s >= 1) {
        dvd.x = [0, Wr, Wr, 0][L.target];
        dvd.y = [0, 0, Hr, Hr][L.target];
        dvdHit(true);
        dvdLeg(false);
      } else if (s > 0 && (bx !== L.bx || by !== L.by)) {
        if (L.t > dt) dvdHit(false); // Aufprall an einer Wand
        L.bx = bx; L.by = by;
      }
    } else {
      dvd.x += dvd.vx * dt;
      dvd.y += dvd.vy * dt;
      let hx = false, hy = false;
      if (dvd.x <= 0) { dvd.x = 0; dvd.vx = Math.abs(dvd.vx); hx = true; }
      if (dvd.x >= Wr) { dvd.x = Wr; dvd.vx = -Math.abs(dvd.vx); hx = true; }
      if (dvd.y <= 0) { dvd.y = 0; dvd.vy = Math.abs(dvd.vy); hy = true; }
      if (dvd.y >= Hr) { dvd.y = Hr; dvd.vy = -Math.abs(dvd.vy); hy = true; }
      // Treffer zählt als Ecke, wenn die zweite Wand kurz danach (< 1/8 s) erreicht wird
      const now = performance.now();
      if (hx) dvd.lastX = now;
      if (hy) dvd.lastY = now;
      if (hx || hy) dvdHit(Math.abs((dvd.lastX || -1e9) - (dvd.lastY || -1e9)) < 125);
    }
    dvd.logo.style.transform = `translate3d(${dvd.x}px, ${dvd.y}px, 0)`;
  }
  function startDvd(manual) {
    if (dvd.on || gridMode) return;
    closeViewer(true);
    dvd.on = true;
    dvd.manual = !!manual;
    dvd.el.hidden = false;
    document.body.classList.add('dvd-on');
    VideoPreview.pause(true);
    dvdPrepare();
    dvdColor();
    dvd.x = Math.random() * Math.max(0, innerWidth - dvd.w);
    dvd.y = Math.random() * Math.max(0, innerHeight - dvd.h);
    const sp = dvdSpeed() / Math.SQRT2;
    dvd.vx = Math.random() < 0.5 ? sp : -sp;
    dvd.vy = Math.random() < 0.5 ? sp : -sp;
    dvd.leg = null;
    dvd.lastX = dvd.lastY = 0;
    requestAnimationFrame(() => dvd.el.classList.add('open'));
  }
  function stopDvd() {
    if (!dvd.on) return;
    dvd.on = false;
    dvd.manual = false;
    dvd.el.classList.remove('open', 'corner');
    document.body.classList.remove('dvd-on');
    if (!current) VideoPreview.pause(false);
    lastT = performance.now();
    setTimeout(() => { if (!dvd.on) dvd.el.hidden = true; }, 400);
  }
  addEventListener('resize', () => { if (dvd.on) dvdResize(); });
  setInterval(() => {
    if (current || document.body.classList.contains('obs-on')) lastActivity = Date.now(); // laufendes Video/Livestream ist keine Inaktivität
    if (dvd.on || gridMode || !settings.dvdMode || current || !$('#winner').hidden || !$('#huntFinal').hidden) return;
    if (Date.now() - lastActivity >= (settings.dvdIdle || 5) * 60_000) startDvd(false);
  }, 1000);

  // Mauszeiger ausblenden, wenn er nicht bewegt wird; jede Berührung beendet den Bildschirmschoner
  let cursorTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
  };
  let lastPointer = null;
  addEventListener('pointermove', (e) => {
    // winzige Bewegungen (Maus-Zittern) zählen nicht
    if (lastPointer && Math.hypot(e.clientX - lastPointer[0], e.clientY - lastPointer[1]) < 8) return;
    lastPointer = [e.clientX, e.clientY];
    wake();
    activity();
  }, { passive: true });
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { wake(); activity(); }, { passive: true });

  // Fenstergröße geändert: Kacheln im Bild halten
  addEventListener('resize', () => {
    if (gridMode) return;
    measureObstacles();
    for (const b of bubbles.values()) {
      b.x = Math.min(Math.max(b.x, b.w / 2), innerWidth - b.w / 2);
      b.y = Math.min(Math.max(b.y, b.h / 2), innerHeight - b.h / 2);
    }
  });
  document.addEventListener('visibilitychange', () => { lastT = performance.now(); });

  /* ---------------- Start ---------------- */
  async function refresh(highlightId) {
    try { await loadState(); await sync(highlightId); } catch (e) { console.warn(e); }
  }
  connectEvents('wall', params.get('name') || (gridMode ? `Verbund ${gridPos}` : 'Wall'), {
    grid: onGrid,
    quiz: () => loadState().catch(() => {}),
    items: (d) => refresh(d.added),
    settings: () => refresh(),
    hunt: () => loadState().catch(() => {}),
    program: () => loadState().catch(() => {}),
    nowplaying: (d) => renderNowPlaying(d.song, d.v),
    obs: (d) => renderObs(d),
    reconnect: () => refresh(),
    command: (c) => {
      if (c.action === 'reload') location.reload();
      if (c.action === 'close') closeViewer();
      if (c.action === 'dvd') startDvd(true);
      if (c.action === 'wake') activity();
      if (c.action === 'show') {
        const item = items.find((i) => i.id === c.id);
        if (item) openViewer(item);
      }
      if (c.action === 'stage') { // „Jetzt auf die Bühne“: im neuen Design auf der Bühne, sonst groß öffnen
        const item = items.find((i) => i.id === c.id);
        if (!item) return;
        activity();
        if (layout && layout.feature) { closeViewer(true); layout.feature(item); } else openViewer(item);
      }
    },
  }, gridMode ? { grid: '1' } : {});
  Fullscreen.install();
  refresh().then(() => requestAnimationFrame(tick));
  wake();
  window.wallDebug = { Preload, obstacles: () => obstacles, dvd };
})();
