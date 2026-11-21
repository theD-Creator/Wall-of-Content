'use strict';
/* Gemeinsame Helfer für Wall, Fotostation und Admin-Panel */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.json !== undefined) {
    opts.body = JSON.stringify(opts.json);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* kein JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Live-Verbindung zum Server; verbindet sich automatisch neu. */
function connectEvents(role, name, handlers, extra = {}) {
  const params = new URLSearchParams({ role, ...extra });
  if (name) params.set('name', name);
  const es = new EventSource('/api/events?' + params);
  let first = true;
  es.addEventListener('hello', () => {
    if (!first && handlers.reconnect) handlers.reconnect();
    first = false;
  });
  for (const type of ['items', 'settings', 'devices', 'command', 'hunt', 'quiz', 'grid', 'program', 'challenges', 'shop', 'feedback']) {
    es.addEventListener(type, (e) => handlers[type] && handlers[type](JSON.parse(e.data)));
  }
  return es;
}

/** Text in die Zwischenablage – auch ohne HTTPS (dort fehlt navigator.clipboard). */
async function copyText(text, input) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback unten */ }
  const ta = input || el('textarea', { value: text, readOnly: true, style: 'position:fixed;left:-9999px;top:0' });
  const tmp = !input;
  const wasPw = ta.type === 'password';
  if (tmp) document.body.append(ta);
  if (wasPw) ta.type = 'text';
  ta.focus(); ta.select();
  try { ta.setSelectionRange(0, text.length); } catch { /* egal */ }
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nicht möglich */ }
  if (wasPw) ta.type = 'password';
  if (tmp) ta.remove();
  else ta.blur();
  return ok;
}

/* ---------------- Vollbild (alle Geräte außer Besucher-App) ---------------- */
const Fullscreen = {
  supported: () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
  active: () => !!(document.fullscreenElement || document.webkitFullscreenElement),
  enter() {
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return;
    try { const p = req.call(root, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch { /* abgelehnt */ }
  },
  exit() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) try { const p = fn.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* egal */ }
  },
  toggle() { if (Fullscreen.active()) Fullscreen.exit(); else Fullscreen.enter(); },
  /** Knopf einbauen; `auto` = beim ersten Antippen automatisch in den Vollbildmodus. */
  install(target) {
    const b = document.body;
    if (!b || b.classList.contains('portal') || (b.classList.contains('download') && !b.classList.contains('redeem')) || window.top !== window || !Fullscreen.supported()) return null;
    const btn = el('button', { type: 'button', class: 'fs-btn', title: 'Vollbild (Taste F)', 'aria-label': 'Vollbild umschalten', onclick: () => Fullscreen.toggle() });
    const update = () => {
      const on = Fullscreen.active();
      btn.textContent = on ? '⤡' : '⛶';
      btn.title = on ? 'Vollbild beenden (Taste F)' : 'Vollbild (Taste F)';
      b.classList.toggle('is-fullscreen', on);
    };
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, update);
    update();
    (target || b).append(btn);
    if (!b.classList.contains('admin')) {
      addEventListener('keydown', (e) => {
        if ((e.key === 'f' || e.key === 'F') && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) Fullscreen.toggle();
      });
    }
    return btn;
  },
  /** Beim ersten Antippen Vollbild anfordern (Browser erlauben es nur nach einer Berührung). */
  auto(enabled) {
    Fullscreen.autoOn = !!enabled;
    if (Fullscreen.autoBound) return;
    Fullscreen.autoBound = true;
    addEventListener('pointerup', () => {
      if (Fullscreen.autoOn && !Fullscreen.active() && Fullscreen.supported() && window.top === window && !document.body.classList.contains('admin')) Fullscreen.enter();
    }, { passive: true });
  },
};

/**
 * Design „neu“ oder „klassisch“ setzen (Einstellung im Admin-Panel). Per Adresse erzwingbar: ?design=klassisch
 * design.js setzt es schon im <head>, damit nichts flackert; hier wird es mit den Einstellungen abgeglichen.
 */
function applyDesign(settings) {
  const root = document.documentElement;
  if (root.dataset.designForced) return root.dataset.design;
  const d = settings && settings.design === 'klassisch' ? 'klassisch' : 'neu';
  root.dataset.design = d;
  try { localStorage.setItem('wocDesign', d); } catch { /* egal */ }
  return d;
}

function applyTheme(settings, backgroundUrl, logoUrl) {
  applyDesign(settings);
  for (const img of $$('img.logo')) { img.hidden = !logoUrl; if (logoUrl) img.src = logoUrl; }
  document.documentElement.style.setProperty('--accent', settings.accent || '#7c5cff');
  if ('autoFullscreen' in settings) Fullscreen.auto(settings.autoFullscreen);
  const bg = $('#bg');
  if (!bg) return;
  const isVideo = /\.(mp4|webm)$/i.test(backgroundUrl || '');
  bg.style.backgroundImage = backgroundUrl && !isVideo ? `url("${backgroundUrl}")` : '';
  bg.classList.toggle('has-image', !!backgroundUrl);
  // animiertes Video als Hintergrund
  let video = $('video', bg);
  if (!isVideo) { if (video) video.remove(); return; }
  if (!video) {
    video = el('video', { muted: true, loop: true, autoplay: true, playsInline: true });
    video.setAttribute('muted', '');
    bg.append(video);
  }
  if (video.dataset.src !== backgroundUrl) {
    video.dataset.src = backgroundUrl;
    video.src = backgroundUrl;
    video.play().catch(() => {});
  }
}

/**
 * Bewegte Vorschau für Videos (Wall-Kacheln, Bühnen-Leiste, Mosaik, Admin-Liste).
 * Videos laufen stumm in Schleife, aber nur, solange sie sichtbar sind, und höchstens `max` gleichzeitig –
 * sonst würden viele Videos den Rechner ausbremsen. Alle anderen zeigen ein Standbild und rücken nach,
 * sobald ein Platz frei wird.
 */
const VideoPreview = {
  max: /iPad|iPhone|iPod/.test(navigator.userAgent) ? 2 : 4,
  paused: false,
  nodes: new Set(),
  make(item, attrs = {}) {
    const still = item.thumb
      ? el('img', { src: item.thumb, alt: '', draggable: false, decoding: 'async', ...attrs })
      : el('video', { src: item.url + '#t=0.5', muted: true, playsInline: true, preload: 'metadata', ...attrs });
    still.dataset.previewUrl = item.url;
    if (item.thumb) still.dataset.previewPoster = item.thumb;
    this.nodes.add(still);
    this.kick();
    return still;
  },
  live() { return [...this.nodes].filter((n) => n.dataset.previewLive).length; },
  visible(n) {
    if (!n.isConnected) return false;
    const r = n.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  },
  /** Standbild <-> laufendes Video austauschen, ohne Layout zu ändern. */
  swap(from, live) {
    let to;
    if (live) {
      to = el('video', { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
      to.muted = true;
      to.setAttribute('muted', '');
      if (from.dataset.previewPoster) to.poster = from.dataset.previewPoster;
      to.src = from.dataset.previewUrl;
      to.dataset.previewLive = '1';
      to.addEventListener('error', () => { if (to.isConnected) this.swap(to, false); }, { once: true });
    } else {
      to = from.dataset.previewPoster
        ? el('img', { src: from.dataset.previewPoster, alt: '', draggable: false })
        : el('video', { src: from.dataset.previewUrl + '#t=0.5', muted: true, playsInline: true, preload: 'metadata' });
    }
    to.className = from.className;
    if (from.getAttribute('style')) to.setAttribute('style', from.getAttribute('style'));
    for (const k of ['previewUrl', 'previewPoster']) if (from.dataset[k]) to.dataset[k] = from.dataset[k];
    this.nodes.delete(from);
    this.nodes.add(to);
    if (from.isConnected) from.replaceWith(to);
    if (from.tagName === 'VIDEO') { from.pause(); from.removeAttribute('src'); from.load(); }
    if (live) to.play?.().catch(() => {});
    return to;
  },
  sweep() {
    for (const n of [...this.nodes]) {
      if (!n.isConnected) {
        this.nodes.delete(n);
        if (n.tagName === 'VIDEO') { n.pause(); n.removeAttribute('src'); n.load(); }
      } else if (n.dataset.previewLive && (this.paused || !this.visible(n))) {
        this.swap(n, false);
      }
    }
    if (this.paused) return;
    let free = this.max - this.live();
    for (const n of [...this.nodes]) {
      if (free <= 0) break;
      if (!n.dataset.previewLive && this.visible(n)) { this.swap(n, true); free--; }
    }
  },
  kick() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.sweep(), 120);
    if (!this.timer) this.timer = setInterval(() => this.sweep(), 1500);
  },
  pause(on) { this.paused = !!on; this.sweep(); },
};
