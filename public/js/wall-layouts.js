'use strict';
/**
 * Neue Wall-Layouts (Design „neu“): Bühne, Mosaik und beides im Wechsel.
 *   WallLayouts.mount(kind, host, ctx) -> { update(items, {fresh}), settings(s, program, logo), pause(on), destroy() }
 * ctx: { open(item) – Viewer öffnen, now() – Serverzeit }
 * Die Layouts wechseln Inhalte sanft innerhalb ihrer Fläche. Groß über der Wall geöffnet wird nur nach Antippen
 * (oder per Show-Modus) – das macht weiterhin wall.js.
 */
(() => {
  const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const ago = (ms, now) => {
    const m = Math.round((now - ms) / 60000);
    return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min` : `vor ${Math.floor(m / 60)} Std`;
  };
  const KIND = { photo: '📸 Fotostation', video: '🎬 Video', image: '🖼️ Bild' };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
  const twice = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  /** Bild oder Video für eine Kachel/Bühne. */
  function media(item, { full = false, play = false } = {}) {
    if (item.kind === 'video' && play) {
      const v = el('video', { src: item.url, playsInline: true, autoplay: true, poster: item.thumb || '', preload: 'auto' });
      v.muted = true;
      v.setAttribute('muted', '');
      return v;
    }
    if (item.kind === 'video' && !item.thumb) return el('video', { src: item.url + '#t=0.5', muted: true, playsInline: true, preload: 'metadata' });
    return el('img', { src: full && item.kind !== 'video' ? item.url : (item.thumb || item.url), alt: '', draggable: false, decoding: 'async' });
  }
  /** Videos sauber stoppen, damit kein Download weiterläuft. */
  function release(node) {
    for (const v of node.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
  }

  /* ---------------- Programm-Band: „Jetzt live“ / „Gleich“ ---------------- */
  function renderBand(box, program, now) {
    const live = program.filter((p) => p.start <= now && now < p.end);
    const next = program.filter((p) => p.start > now).sort((a, b) => a.start - b.start)[0];
    const parts = live.slice(0, 2).map((p) => el('div', { class: 'band-item live' },
      el('span', { class: 'pill pill-live', text: '● Jetzt live' }),
      el('b', { text: p.title }),
      el('span', { class: 'band-time', text: `bis ${hm(p.end)} Uhr` })));
    if (next) {
      parts.push(el('div', { class: 'band-item next' },
        el('span', { class: 'pill pill-next', text: `Gleich · ${hm(next.start)}` }),
        el('b', { text: next.title })));
    }
    if (!parts.length) {
      parts.push(el('div', { class: 'band-item' },
        el('span', { class: 'pill pill-next', text: 'Mach mit' }),
        el('b', { text: 'Fotostation · Color Hunt · Challenges' })));
    }
    box.replaceChildren(...parts);
  }

  /* ======================= Bühne ======================= */
  function Buehne(host, ctx) {
    const title = el('h1');
    const sub = el('p');
    const clock = el('div', { class: 'lb-clock' });
    const logo = el('img', { class: 'lb-logo', alt: '', hidden: true });
    const bar = el('i');
    const stage = el('section', { class: 'lb-stage', tabindex: 0, 'aria-label': 'Highlight – antippen zum Vergrößern' },
      el('div', { class: 'lb-progress' }, bar));
    const railList = el('div', { class: 'lb-rail-list' });
    const bandItems = el('div', { class: 'band-items' });
    const root = el('div', { class: 'L-buehne' },
      el('header', { class: 'lb-head' },
        el('div', { class: 'lb-titles' }, el('small', { class: 'lb-kicker', text: 'Wall of Content' }), title, sub),
        el('div', { class: 'lb-head-right' }, logo, clock)),
      stage,
      el('aside', { class: 'lb-rail' }, el('h2', {}, el('span', { class: 'pill pill-new', text: 'Neu' }), 'Neueste Inhalte'), railList),
      el('footer', { class: 'lb-band' }, bandItems));
    host.append(root);

    let items = [];
    let queue = [];
    let cur = null;
    let slide = null;
    let timer = null;
    let paused = false;
    let settings = {};
    let program = [];

    // Platz für die QR-Codes im Band reservieren (die liegen als eigene Elemente darüber)
    const qrStack = document.querySelector('.qr-stack');
    const measure = () => {
      const r = qrStack && qrStack.getBoundingClientRect();
      root.style.setProperty('--qr-w', r && r.width ? r.width + 'px' : '0px');
      root.style.setProperty('--qr-h', r && r.height ? r.height + 'px' : '0px');
    };
    const ro = qrStack && new ResizeObserver(measure);
    if (ro) ro.observe(qrStack);
    measure();

    function nextItem() {
      if (!items.length) return null;
      const byId = new Map(items.map((i) => [i.id, i]));
      for (let guard = 0; guard < 2; guard++) {
        if (!queue.length) queue = shuffle(items.map((i) => i.id));
        while (queue.length) {
          const id = queue.shift();
          if (byId.has(id) && (items.length === 1 || !cur || id !== cur.id)) return byId.get(id);
        }
      }
      return items[0];
    }
    function restart(secs) {
      clearTimeout(timer);
      bar.style.transition = 'none';
      bar.style.width = '0%';
      if (paused) return;
      twice(() => { bar.style.transition = `width ${secs}s linear`; bar.style.width = '100%'; });
      timer = setTimeout(advance, secs * 1000);
    }
    function show(item, fresh) {
      clearTimeout(timer);
      stage.classList.toggle('empty', !item);
      if (!item) return;
      cur = item;
      const isVideo = item.kind === 'video';
      const m = media(item, { full: true, play: isVideo });
      const blurSrc = item.thumb || (isVideo ? '' : item.url);
      const next = el('div', { class: 'lb-slide' },
        blurSrc && el('div', { class: 'lb-blur', style: `background-image:${cssUrl(blurSrc)}` }),
        m,
        el('div', { class: 'lb-caption' },
          el('span', { class: 'pill pill-kind', text: KIND[item.kind] || 'Inhalt' }),
          fresh && el('span', { class: 'pill pill-new', text: 'Neu' }),
          item.title && el('b', { text: item.title }),
          el('span', { class: 'lb-ago', text: ago(item.createdAt, ctx.now()) })));
      const old = slide;
      slide = next;
      stage.insertBefore(next, stage.firstChild);
      twice(() => next.classList.add('in'));
      if (old) {
        old.classList.remove('in');
        old.classList.add('out');
        setTimeout(() => { release(old); old.remove(); }, 1000);
      }
      const secs = settings.stageSeconds || 9;
      if (isVideo) {
        // Videos laufen stumm durch (max. 60 s); Ton gibt es nach Antippen im großen Viewer
        m.addEventListener('loadedmetadata', () => { if (cur === item) restart(Math.min(60, Math.max(secs, m.duration || secs))); }, { once: true });
        m.addEventListener('ended', () => { if (cur === item && !paused) advance(); }, { once: true });
        m.play?.().catch(() => {});
      }
      restart(secs);
    }
    function advance() { show(nextItem(), false); }
    stage.addEventListener('click', () => { if (cur) ctx.open(cur); });

    function renderRail(fresh) {
      const latest = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
      release(railList);
      railList.replaceChildren(...latest.map((it) => el('button', {
        class: 'lb-card' + (fresh.includes(it.id) ? ' fresh' : ''), type: 'button',
        'aria-label': it.title || 'Inhalt öffnen', onclick: () => ctx.open(it),
      }, media(it), el('span', { class: 'lb-card-meta' },
        el('b', { text: it.title || KIND[it.kind] || 'Inhalt' }),
        el('small', { text: ago(it.createdAt, ctx.now()) })))));
    }
    const tickClock = () => { clock.textContent = hm(ctx.now()); renderBand(bandItems, program, ctx.now()); };
    const clockTimer = setInterval(tickClock, 10_000);

    return {
      update(list, { fresh = [] } = {}) {
        items = list;
        renderRail(fresh);
        const byId = new Map(items.map((i) => [i.id, i]));
        const newest = fresh.filter((id) => byId.has(id)).pop();
        if (newest) show(byId.get(newest), true);           // neues Foto sofort auf die Bühne
        else if (!cur || !byId.has(cur.id)) show(nextItem(), false);
      },
      settings(s, prog, logoUrl) {
        settings = s;
        program = prog || [];
        title.textContent = s.title || '';
        sub.textContent = s.subtitle || '';
        logo.hidden = !logoUrl;
        if (logoUrl) logo.src = logoUrl;
        tickClock();
        measure();
      },
      pause(on) {
        paused = on;
        const v = slide && slide.querySelector('video');
        if (on) { clearTimeout(timer); bar.style.transition = 'none'; if (v) v.pause(); }
        else { if (v) v.play().catch(() => {}); restart(settings.stageSeconds || 9); }
      },
      destroy() { clearTimeout(timer); clearInterval(clockTimer); if (ro) ro.disconnect(); release(root); root.remove(); },
    };
  }

  /* ======================= Mosaik ======================= */
  function Mosaik(host, ctx) {
    const grid = el('div', { class: 'lm-grid' });
    const title = el('h1');
    const bandItems = el('div', { class: 'band-items' });
    const root = el('div', { class: 'L-mosaik' },
      grid,
      el('div', { class: 'lm-title' }, el('small', { class: 'lb-kicker', text: 'Wall of Content' }), title),
      el('div', { class: 'lm-band' }, bandItems));
    host.append(root);

    let items = [];
    let tiles = [];
    let program = [];
    let paused = false;
    let cols = 0;
    let rows = 0;

    function dims() {
      const c = Math.min(8, Math.max(3, Math.round(innerWidth / 300)));
      const r = Math.max(2, Math.round(innerHeight / (innerWidth / c)));
      return [c, r];
    }
    /** Lückenlose Aufteilung in große (2×2), breite/hohe (2×1, 1×2) und kleine Kacheln. */
    function tiling(c, r) {
      const used = Array.from({ length: r }, () => Array(c).fill(false));
      const out = [];
      const fits = (y, x, h, w) => {
        if (y + h > r || x + w > c) return false;
        for (let i = y; i < y + h; i++) for (let j = x; j < x + w; j++) if (used[i][j]) return false;
        return true;
      };
      const put = (y, x, h, w) => {
        for (let i = y; i < y + h; i++) for (let j = x; j < x + w; j++) used[i][j] = true;
        out.push({ y, x, h, w });
      };
      const bigs = Math.max(1, Math.floor((c * r) / 14));
      for (let k = 0; k < bigs; k++) {
        for (let t = 0; t < 40; t++) {
          const y = Math.floor(Math.random() * (r - 1)), x = Math.floor(Math.random() * (c - 1));
          if (fits(y, x, 2, 2)) { put(y, x, 2, 2); break; }
        }
      }
      const wides = Math.floor((c * r) / 8);
      for (let k = 0; k < wides; k++) {
        for (let t = 0; t < 30; t++) {
          const tall = Math.random() < 0.4;
          const h = tall ? 2 : 1, w = tall ? 1 : 2;
          const y = Math.floor(Math.random() * r), x = Math.floor(Math.random() * c);
          if (fits(y, x, h, w)) { put(y, x, h, w); break; }
        }
      }
      for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) if (!used[y][x]) put(y, x, 1, 1);
      return out.sort((a, b) => b.h * b.w - a.h * a.w); // große zuerst
    }

    function fill(tile, item, fresh) {
      const layer = el('div', { class: 'lm-layer' }, media(item),
        item.kind === 'video' && el('span', { class: 'lm-play', text: '▶' }),
        fresh && el('span', { class: 'pill pill-new lm-new', text: 'Neu' }));
      const old = tile.querySelector('.lm-layer.in');
      tile.append(layer);
      tile._item = item;
      twice(() => layer.classList.add('in'));
      if (old) { old.classList.remove('in'); setTimeout(() => { release(old); old.remove(); }, 1300); }
    }
    function order(n) {
      if (!items.length) return [];
      const newest = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
      const pool = shuffle(items.filter((i) => !newest.includes(i)));
      const list = [...newest, ...pool];
      return Array.from({ length: n }, (_, i) => list[i % list.length]);
    }
    function build() {
      [cols, rows] = dims();
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      release(grid);
      tiles = tiling(cols, rows).map(({ y, x, h, w }) => {
        const tile = el('button', {
          class: 'lm-tile' + (h * w > 1 ? ' big' : ''), type: 'button', 'aria-label': 'Inhalt öffnen',
          style: `grid-row:${y + 1} / span ${h};grid-column:${x + 1} / span ${w}`,
          onclick: () => { if (tile._item) ctx.open(tile._item); },
        });
        return tile;
      });
      grid.replaceChildren(...tiles);
      order(tiles.length).forEach((item, i) => fill(tiles[i], item, false));
    }
    // regelmäßig eine Kachel tauschen – bevorzugt mit etwas, das gerade nicht zu sehen ist
    const swapTimer = setInterval(() => {
      if (paused || !tiles.length || !items.length) return;
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      const visible = new Set(tiles.map((t) => t._item && t._item.id));
      const hidden = items.filter((i) => !visible.has(i.id));
      const pick = hidden.length ? hidden[Math.floor(Math.random() * hidden.length)] : items[Math.floor(Math.random() * items.length)];
      if (pick && pick !== tile._item) fill(tile, pick, false);
    }, 3200);
    // alle 75 s eine neue Aufteilung, damit es lebendig bleibt
    const retile = setInterval(() => {
      if (paused || !items.length) return;
      grid.classList.add('fade');
      setTimeout(() => { build(); grid.classList.remove('fade'); }, 700);
    }, 75_000);
    let resizeT = null;
    const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const [c, r] = dims(); if (c !== cols || r !== rows) build(); }, 300); };
    addEventListener('resize', onResize);
    const bandTimer = setInterval(() => renderBand(bandItems, program, ctx.now()), 10_000);

    return {
      update(list, { fresh = [] } = {}) {
        const first = !items.length;
        items = list;
        if (first || !tiles.length) { build(); }
        const byId = new Map(items.map((i) => [i.id, i]));
        for (const t of tiles) if (t._item && !byId.has(t._item.id)) fill(t, order(1)[0] || t._item, false);
        fresh.filter((id) => byId.has(id)).forEach((id, n) => {
          const tile = tiles[n % Math.max(1, tiles.length)]; // neue Fotos in die großen Kacheln
          if (!tile) return;
          fill(tile, byId.get(id), true);
          tile.classList.remove('flash');
          void tile.offsetWidth;
          tile.classList.add('flash');
        });
        if (!items.length) { release(grid); grid.replaceChildren(); tiles = []; }
      },
      settings(s, prog) {
        program = prog || [];
        title.textContent = s.title || '';
        renderBand(bandItems, program, ctx.now());
      },
      pause(on) { paused = on; },
      destroy() {
        clearInterval(swapTimer); clearInterval(retile); clearInterval(bandTimer);
        removeEventListener('resize', onResize);
        release(root); root.remove();
      },
    };
  }

  /* ======================= Wechsel: Bühne ⇄ Mosaik ======================= */
  function Wechsel(host, ctx) {
    let kind = 'buehne';
    let inner = null;
    let box = null;
    let items = [];
    let args = [{}, [], null];
    let timer = null;
    let paused = false;
    function mount() {
      const oldInner = inner, oldBox = box;
      box = el('div', { class: 'L-switch' });
      host.append(box);
      inner = (kind === 'buehne' ? Buehne : Mosaik)(box, ctx);
      inner.settings(...args);
      inner.update(items, {});
      if (paused) inner.pause(true);
      twice(() => box.classList.add('in'));
      if (oldInner) setTimeout(() => { oldInner.destroy(); oldBox.remove(); }, 1000);
    }
    function schedule() {
      clearInterval(timer);
      timer = setInterval(() => {
        if (paused) return;
        kind = kind === 'buehne' ? 'mosaik' : 'buehne';
        mount();
      }, Math.max(1, args[0].layoutMinutes || 4) * 60_000);
    }
    mount();
    return {
      update(list, opts) { items = list; inner.update(list, opts); },
      settings(s, prog, logoUrl) {
        const changed = (args[0].layoutMinutes || 4) !== (s.layoutMinutes || 4);
        args = [s, prog, logoUrl];
        inner.settings(...args);
        if (changed || !timer) schedule();
      },
      pause(on) { paused = on; inner.pause(on); },
      destroy() { clearInterval(timer); inner.destroy(); box.remove(); },
    };
  }

  window.WallLayouts = {
    mount(kind, host, ctx) {
      return ({ buehne: Buehne, mosaik: Mosaik, wechsel: Wechsel }[kind] || Buehne)(host, ctx);
    },
  };
})();
