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
  function media(item, { full = false, play = false, preview = false } = {}) {
    if (item.kind === 'video' && preview) return VideoPreview.make(item); // bewegte Vorschau (Leiste, Mosaik)
    if (item.kind === 'video' && play) {
      const v = el('video', { src: item.url, playsInline: true, autoplay: true, poster: item.thumb || '', preload: 'auto' });
      v.muted = true;
      v.setAttribute('muted', '');
      return v;
    }
    if (item.kind === 'video' && !item.thumb) return el('video', { src: item.url + '#t=0.5', muted: true, playsInline: true, preload: 'metadata' });
    return el('img', { src: full && item.kind !== 'video' ? item.url : (item.thumb || item.url), alt: '', draggable: false, decoding: 'async' });
  }
  /** Natürliche Größe eines Bildes/Videos, sobald bekannt. */
  function whenSized(m, fn) {
    const go = () => { const w = m.naturalWidth || m.videoWidth, h = m.naturalHeight || m.videoHeight; if (w && h) fn(w, h); };
    if (m.tagName === 'IMG') { if (m.complete) go(); else m.addEventListener('load', go, { once: true }); }
    else if (m.readyState >= 1) go(); else m.addEventListener('loadedmetadata', go, { once: true });
  }
  /**
   * Kleine Dateien nicht riesig aufblasen: höchstens auf das `max`-fache ihrer echten Größe.
   * Große Dateien passen sich ganz normal ein (object-fit: contain).
   */
  function capUpscale(m, box, max = 2) {
    whenSized(m, (w, h) => {
      const s = Math.min(box.clientWidth / w, box.clientHeight / h);
      if (!(s > max)) return;
      m.classList.add('capped');
      m.style.width = Math.round(w * max) + 'px';
      m.style.height = Math.round(h * max) + 'px';
    });
  }
  /** Platz für die QR-Codes im Band reservieren (die liegen als eigene Elemente darüber). */
  function reserveQr(root) {
    const qrStack = document.querySelector('.qr-stack');
    const measure = () => {
      const r = qrStack && qrStack.getBoundingClientRect();
      root.style.setProperty('--qr-w', r && r.width ? r.width + 'px' : '0px');
      root.style.setProperty('--qr-h', r && r.height ? r.height + 'px' : '0px');
    };
    const ro = qrStack && new ResizeObserver(measure);
    if (ro) ro.observe(qrStack);
    measure();
    return { measure, stop: () => ro && ro.disconnect() };
  }
  /** Hoch- oder Querformat (iPad hochkant, Handy) – die Layouts ordnen sich danach an. */
  const isPortrait = () => innerWidth / innerHeight < 1.05;

  /** Videos sauber stoppen, damit kein Download weiterläuft. */
  function release(node) {
    for (const v of node.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
  }

  /* ---------------- Programm-Band: „Jetzt live“ / „Gleich“ ---------------- */
  /** Moment gilt als „LIVE“, solange er jünger ist als die eingestellte Zeit. */
  const isLive = (it, s, now) => !!(it && it.moment && now - it.moment.at < (s.momentHighlightMin || 15) * 60_000);
  /** Darf ein neuer Inhalt sofort auf die Bühne springen? Moments nur, wenn „Sofort groß“ an ist. */
  const jumps = (it, s) => !it.moment || s.momentInstant !== false;

  /** Live-Ticker: die neuesten Moments wechseln sich im Band ab (alle 8 s). */
  function tickerItem(items, s, now) {
    if (!s.momentTicker) return null;
    const list = items.filter((i) => i.moment).sort((a, b) => b.moment.at - a.moment.at).slice(0, 5);
    if (!list.length) return null;
    const m = list[Math.floor(now / 8000) % list.length];
    return el('div', { class: 'band-item ticker' },
      el('span', { class: 'pill ' + (isLive(m, s, now) ? 'pill-live' : 'pill-moment'), text: isLive(m, s, now) ? '● Live Moment' : '📍 Moment' }),
      el('b', { text: m.moment.caption || 'Neuer Moment von ' + m.moment.by }),
      m.moment.tags.length > 0 && el('span', { class: 'band-time', text: m.moment.tags.slice(0, 3).join(' ') }));
  }

  function renderBand(box, program, now, ticker) {
    const live = program.filter((p) => p.start <= now && now < p.end);
    const next = program.filter((p) => p.start > now).sort((a, b) => a.start - b.start)[0];
    const parts = live.slice(0, ticker ? 1 : 2).map((p) => el('div', { class: 'band-item live' },
      el('span', { class: 'pill pill-live', text: '● Jetzt live' }),
      el('b', { text: p.title }),
      el('span', { class: 'band-time', text: `bis ${hm(p.end)} Uhr` })));
    if (next) {
      parts.push(el('div', { class: 'band-item next' },
        el('span', { class: 'pill pill-next', text: `Gleich · ${hm(next.start)}` }),
        el('b', { text: next.title })));
    }
    if (ticker) parts.unshift(ticker);
    if (!parts.length) {
      parts.push(el('div', { class: 'band-item' },
        el('span', { class: 'pill pill-next', text: 'Mach mit' }),
        el('b', { text: 'Fotostation · Color Hunt · Challenges' })));
    }
    box.replaceChildren(...parts);
  }

  /* ======================= „Alle Inhalte“ zum Stöbern ======================= */
  /**
   * Großes Raster über der Wall: Besucher filtern nach Fotos, Videos, Moments und Hashtags und tippen an.
   * Schließt sich nach 45 s ohne Berührung von selbst. Liegt unter dem Viewer, damit man danach weiterstöbern kann.
   */
  function openBrowser(items, ctx, onClose) {
    let filter = 'alle';
    const tags = [...new Set(items.flatMap((i) => (i.moment ? i.moment.tags : [])))].slice(0, 12);
    const grid = el('div', { class: 'wb-grid' });
    const chips = el('div', { class: 'wb-chips' });
    const close = () => { clearTimeout(idle); box.classList.remove('open'); setTimeout(() => { release(box); box.remove(); }, 350); onClose && onClose(); };
    const box = el('div', { class: 'wall-browse', role: 'dialog', 'aria-label': 'Alle Inhalte' },
      el('header', { class: 'wb-head' },
        el('div', {}, el('small', { class: 'lb-kicker', text: 'Selbst stöbern' }), el('h2', { text: 'Alle Inhalte' })),
        el('button', { class: 'wb-close', type: 'button', 'aria-label': 'Schließen', text: '✕', onclick: close })),
      chips, el('div', { class: 'wb-scroll' }, grid));
    const has = (k) => items.some((i) => (k === 'moment' ? i.moment : k === 'image' ? i.kind === 'image' && !i.moment : i.kind === k));
    const FILTERS = [['alle', 'Alle'], ['photo', '📸 Fotostation'], ['image', '🖼️ Bilder'], ['video', '🎬 Videos'], ['moment', '📍 Moments']]
      .filter(([k]) => k === 'alle' || has(k));
    function render() {
      chips.replaceChildren(...FILTERS.map(([k, t]) => el('button', { type: 'button', class: 'pill' + (filter === k ? ' on' : ''), text: t, onclick: () => { filter = k; render(); } })),
        ...tags.map((t) => el('button', { type: 'button', class: 'pill pill-tag' + (filter === t ? ' on' : ''), text: t, onclick: () => { filter = t; render(); } })));
      const list = [...items].sort((a, b) => b.createdAt - a.createdAt).filter((i) => filter === 'alle' ? true
        : filter.startsWith('#') ? i.moment && i.moment.tags.includes(filter)
          : filter === 'moment' ? !!i.moment : filter === 'image' ? i.kind === 'image' && !i.moment : i.kind === filter);
      release(grid);
      grid.replaceChildren(...list.map((it) => el('button', {
        type: 'button', class: 'wb-tile', 'aria-label': it.title || 'Inhalt öffnen', onclick: () => ctx.open(it),
      }, it.kind === 'video' ? media(it, { preview: true }) : el('img', { src: it.thumb || it.url, alt: '', loading: 'lazy', decoding: 'async' }),
      it.kind === 'video' && el('span', { class: 'lm-play', text: '▶' }),
      (it.title || it.moment) && el('span', { class: 'wb-cap', text: (it.moment ? '📍 ' : '') + ((it.moment && it.moment.caption) || it.title || '') }))));
      grid.parentNode && (grid.parentNode.scrollTop = 0);
    }
    let idle = null;
    const poke = () => { clearTimeout(idle); idle = setTimeout(() => { if (!document.querySelector('#viewer.open')) close(); else poke(); }, 45_000); };
    box.addEventListener('pointerdown', poke);
    box.addEventListener('scroll', poke, { passive: true, capture: true });
    render();
    document.body.append(box);
    twice(() => box.classList.add('open'));
    poke();
    return close;
  }
  /** Knopf „Alle Inhalte“ für die Kopfzeile. */
  function browseButton(getItems, ctx, layout) {
    let closeFn = null;
    const b = el('button', {
      class: 'lb-browse', type: 'button', text: '▦ Alle Inhalte',
      onclick: () => {
        if (closeFn) return;
        layout.pause(true);
        closeFn = openBrowser(getItems(), ctx, () => { closeFn = null; layout.pause(false); });
      },
    });
    b.closeBrowser = () => closeFn && closeFn();
    return b;
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
    const api = {};
    const browse = browseButton(() => items, ctx, api);
    const root = el('div', { class: 'L-buehne' },
      el('header', { class: 'lb-head' },
        el('div', { class: 'lb-titles' }, el('small', { class: 'lb-kicker', text: 'Wall of Content' }), title, sub),
        el('div', { class: 'lb-head-right' }, browse, logo, clock)),
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

    const qr = reserveQr(root);
    const measure = qr.measure;
    // nur so viele Karten zeigen, wie ganz in die Leiste passen – nichts wird angeschnitten
    function fitRail() {
      const row = root.classList.contains('portrait');
      const limit = row ? railList.clientWidth : railList.clientHeight;
      for (const c of railList.children) {
        c.hidden = false;
        const end = row ? c.offsetLeft + c.offsetWidth : c.offsetTop + c.offsetHeight;
        if (end > limit + 1) c.hidden = true;
      }
    }
    const orient = () => { root.classList.toggle('portrait', isPortrait()); fitRail(); };
    const railRo = new ResizeObserver(() => fitRail());
    railRo.observe(railList);
    addEventListener('resize', orient);
    orient();

    /**
     * Reihenfolge der Bühne: „playlist“ = nur angepinnte in fester Reihenfolge (ohne Playlist: alle),
     * sonst alle zufällig, angepinnte doppelt. Für die Bühne ausgeblendete Inhalte kommen nicht dran.
     */
    function buildQueue() {
      const ok = items.filter((i) => !i.stageHide);
      const pinned = ok.filter((i) => i.pin).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (settings.stageMode === 'playlist' && pinned.length) return pinned.map((i) => i.id);
      return shuffle([...ok, ...pinned].map((i) => i.id));
    }
    function nextItem() {
      if (!items.length) return null;
      const byId = new Map(items.filter((i) => !i.stageHide).map((i) => [i.id, i]));
      if (!byId.size) return items[0];
      for (let guard = 0; guard < 2; guard++) {
        if (!queue.length) queue = buildQueue();
        while (queue.length) {
          const id = queue.shift();
          if (byId.has(id) && (items.length === 1 || !cur || id !== cur.id)) return byId.get(id);
        }
      }
      return byId.values().next().value;
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
      capUpscale(m, stage, 2);
      const blurSrc = item.thumb || (isVideo ? '' : item.url);
      const next = el('div', { class: 'lb-slide' },
        blurSrc && el('div', { class: 'lb-blur', style: `background-image:${cssUrl(blurSrc)}` }),
        m,
        item.moment ? momentCaption(item) : el('div', { class: 'lb-caption' },
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
    /** Bildunterschrift für Moments: LIVE-Badge, Text, Hashtags, wer es gepostet hat. */
    function momentCaption(item) {
      const m = item.moment;
      const live = isLive(item, settings, ctx.now());
      return el('div', { class: 'lb-caption lb-moment' },
        el('div', { class: 'lb-moment-top' },
          el('span', { class: 'pill ' + (live ? 'pill-live' : 'pill-moment'), text: live ? '● Live Moment' : '📍 Moment' }),
          el('span', { class: 'lb-by' }, m.avatar ? el('img', { src: m.avatar, alt: '' }) : null, 'von ' + m.by),
          el('span', { class: 'lb-ago', text: ago(m.at, ctx.now()) })),
        m.caption && el('b', { text: m.caption }),
        m.tags.length > 0 && el('div', { class: 'lb-tags' }, ...m.tags.map((t) => el('span', { text: t }))));
    }
    function advance() { show(nextItem(), false); }
    stage.addEventListener('click', () => { if (cur) ctx.open(cur); });

    function renderRail(fresh) {
      const latest = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
      release(railList);
      railList.replaceChildren(...latest.map((it) => el('button', {
        class: 'lb-card' + (fresh.includes(it.id) ? ' fresh' : ''), type: 'button',
        'aria-label': it.title || 'Inhalt öffnen', onclick: () => ctx.open(it),
      }, media(it, { preview: true }), el('span', { class: 'lb-card-meta' },
        el('b', { text: (it.moment ? '📍 ' : '') + ((it.moment && it.moment.caption) || it.title || KIND[it.kind] || 'Inhalt') }),
        el('small', { text: ago(it.createdAt, ctx.now()) })))));
      fitRail();
    }
    const tickClock = () => { clock.textContent = hm(ctx.now()); renderBand(bandItems, program, ctx.now(), tickerItem(items, settings, ctx.now())); };
    const clockTimer = setInterval(tickClock, 8_000);

    Object.assign(api, {
      update(list, { fresh = [] } = {}) {
        const prev = items;
        items = list;
        renderRail(fresh);
        const byId = new Map(items.map((i) => [i.id, i]));
        // Playlist geändert (Anpinnen, Reihenfolge, Ausblenden)? Dann Reihenfolge neu aufbauen
        const sig = (l) => l.map((i) => `${i.id}:${i.pin ? i.order : ''}:${i.stageHide ? 1 : 0}`).join();
        if (sig(prev) !== sig(list)) queue = [];
        const newest = fresh.filter((id) => byId.has(id) && jumps(byId.get(id), settings)).pop();
        if (newest) show(byId.get(newest), true);           // neues Foto / neuer Moment sofort auf die Bühne
        else if (!cur || !byId.has(cur.id) || (byId.get(cur.id).stageHide && items.some((i) => !i.stageHide))) show(nextItem(), false);
        tickClock();
      },
      /** „Jetzt auf die Bühne“ aus dem Admin-Panel */
      feature(item) { browse.closeBrowser(); show(item, false); },
      settings(s, prog, logoUrl) {
        const modeChanged = settings.stageMode !== undefined && s.stageMode !== settings.stageMode;
        if (s.stageMode !== settings.stageMode) queue = [];
        settings = s;
        // auf „Nur die Playlist“ umgestellt: sofort zur Playlist wechseln, wenn gerade etwas anderes läuft
        if (modeChanged && s.stageMode === 'playlist' && cur && !cur.pin && items.some((i) => i.pin && !i.stageHide)) setTimeout(advance);
        browse.hidden = s.browseButton === false;
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
      destroy() {
        clearTimeout(timer); clearInterval(clockTimer); qr.stop(); railRo.disconnect();
        removeEventListener('resize', orient);
        browse.closeBrowser();
        release(root); root.remove();
      },
    });
    return api;
  }

  /* ======================= Mosaik ======================= */
  function Mosaik(host, ctx) {
    const grid = el('div', { class: 'lm-grid' });
    const title = el('h1');
    const clock = el('div', { class: 'lb-clock' });
    const logo = el('img', { class: 'lb-logo', alt: '', hidden: true });
    const bandItems = el('div', { class: 'band-items' });
    const api = {};
    const browse = browseButton(() => items, ctx, api);
    let settings = {};
    const root = el('div', { class: 'L-mosaik' },
      el('header', { class: 'lm-head' },
        el('div', { class: 'lm-title' }, el('small', { class: 'lb-kicker', text: 'Wall of Content' }), title),
        el('div', { class: 'lb-head-right' }, browse, logo, clock)),
      el('div', { class: 'lm-area' }, grid),
      el('footer', { class: 'lb-band lm-band' }, bandItems));
    host.append(root);
    const qr = reserveQr(root);

    let items = [];
    let tiles = [];
    let program = [];
    let paused = false;
    let cols = 0;
    let rows = 0;

    /** Spalten/Zeilen so wählen, dass die Kacheln ungefähr quadratisch sind. */
    function dims() {
      const W = grid.clientWidth || innerWidth, H = grid.clientHeight || innerHeight;
      const r = Math.min(6, Math.max(2, Math.round(H / Math.max(220, Math.min(W, H) / 3.2))));
      const c = Math.min(9, Math.max(2, Math.round(W / (H / r))));
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
      // große Kacheln bekommen das Originalbild, damit nichts unscharf hochskaliert wird
      const m = media(item, { full: tile.classList.contains('big') || !item.thumb, preview: true });
      const blurSrc = item.thumb || (item.kind === 'video' ? '' : item.url);
      const blur = blurSrc ? el('div', { class: 'lm-blur', style: `background-image:${cssUrl(blurSrc)}` }) : null;
      const layer = el('div', { class: 'lm-layer' }, blur, m,
        item.kind === 'video' && el('span', { class: 'lm-play', text: '▶' }),
        fresh && el('span', { class: 'pill pill-new lm-new', text: 'Neu' }));
      // Passt das Seitenverhältnis nicht zur Kachel (Panorama, Hochformat) oder ist die Datei klein,
      // wird sie ganz gezeigt statt angeschnitten/aufgeblasen – mit unscharfem Hintergrund.
      whenSized(m, (w, h) => {
        const tw = tile.clientWidth, th = tile.clientHeight;
        if (!tw || !th) return;
        const a = w / h, t = tw / th;
        const cover = Math.max(tw / w, th / h);
        const fullFile = m.tagName === 'VIDEO' || m.currentSrc === item.url || m.src.endsWith(item.url);
        if (Math.max(a / t, t / a) > 1.4 || (fullFile && cover > 2.2)) {
          layer.classList.add('fit');
          capUpscale(m, tile, 2);
        }
      });
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
      grid.style.setProperty('--cols', cols);
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
    const areaRo = new ResizeObserver(onResize);
    areaRo.observe(grid);
    const tickClock = () => { clock.textContent = hm(ctx.now()); renderBand(bandItems, program, ctx.now(), tickerItem(items, settings, ctx.now())); };
    const bandTimer = setInterval(tickClock, 8_000);
    const highlight = (item, isNew) => {
      const tile = tiles[0];
      if (!tile) return;
      fill(tile, item, isNew);
      tile.classList.remove('flash');
      void tile.offsetWidth;
      tile.classList.add('flash');
    };

    Object.assign(api, {
      feature(item) { browse.closeBrowser(); highlight(item, false); },
      update(list, { fresh = [] } = {}) {
        const first = !items.length;
        items = list;
        if (first || !tiles.length) { build(); }
        const byId = new Map(items.map((i) => [i.id, i]));
        for (const t of tiles) if (t._item && !byId.has(t._item.id)) fill(t, order(1)[0] || t._item, false);
        fresh.filter((id) => byId.has(id) && jumps(byId.get(id), settings)).forEach((id, n) => {
          const tile = tiles[n % Math.max(1, tiles.length)]; // neue Fotos in die großen Kacheln
          if (!tile) return;
          fill(tile, byId.get(id), true);
          tile.classList.remove('flash');
          void tile.offsetWidth;
          tile.classList.add('flash');
        });
        if (!items.length) { release(grid); grid.replaceChildren(); tiles = []; }
        tickClock();
      },
      settings(s, prog, logoUrl) {
        settings = s;
        browse.hidden = s.browseButton === false;
        program = prog || [];
        title.textContent = s.title || '';
        logo.hidden = !logoUrl;
        if (logoUrl) logo.src = logoUrl;
        tickClock();
        qr.measure();
      },
      pause(on) { paused = on; },
      destroy() {
        clearInterval(swapTimer); clearInterval(retile); clearInterval(bandTimer);
        areaRo.disconnect(); qr.stop(); clearTimeout(resizeT);
        browse.closeBrowser();
        release(root); root.remove();
      },
    });
    return api;
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
      feature(item) { inner.feature(item); },
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
