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

function applyTheme(settings, backgroundUrl, logoUrl) {
  for (const img of $$('img.logo')) { img.hidden = !logoUrl; if (logoUrl) img.src = logoUrl; }
  document.documentElement.style.setProperty('--accent', settings.accent || '#7c5cff');
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
