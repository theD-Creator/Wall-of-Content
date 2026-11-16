'use strict';
/* Color Hunt auf dem Gäste-Handy: Name -> Farbe -> Anleitung -> Fotos in X Minuten -> Abgabe */
(() => {
  let me = null;            // Antwort von /api/hunt/me
  let player = null;
  let offset = 0;           // Serverzeit - lokale Zeit
  let timer = null;
  let slotIndex = 0;
  const uploading = new Set();

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function show(name) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.dataset.screen === name);
    scrollTo(0, 0);
  }
  const serverNow = () => Date.now() + offset;
  const setTime = (now) => { offset = now - Date.now(); };

  function bind() {
    const map = {
      name: player ? player.name : '', color: player ? player.color.name : '',
      count: player ? player.photoCount : me.photoCount, minutes: player ? Math.round(player.duration / 60000) : me.minutes,
    };
    for (const n of $$('[data-bind]')) n.textContent = map[n.dataset.bind];
    if (player) {
      const hex = player.color.hex;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const light = (0.299 * r + 0.587 * g + 0.114 * b) > 160;
      document.body.style.setProperty('--hunt', hex);
      document.body.style.setProperty('--on-hunt', light ? '#111' : '#fff');
    }
  }

  /* ---------------- Ablauf ---------------- */
  function route() {
    bind();
    if (!player) return show(me.active ? 'name' : 'closed');
    if (player.status === 'done') return showDone();
    if (player.status === 'running') return startHunt();
    show('color');
  }

  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#joinError').textContent = '';
    const btn = $('#joinForm button');
    btn.disabled = true;
    try {
      const data = await api('/api/hunt/join', { method: 'POST', json: { name: $('#name').value } });
      player = data.player;
      setTime(data.now);
      route();
    } catch (err) {
      $('#joinError').textContent = err.message;
      if (err.status === 409) load(); // schon dabei -> Zustand neu laden
    } finally {
      btn.disabled = false;
    }
  });
  for (const b of $$('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  for (const b of $$('[data-action="reload"]')) b.addEventListener('click', () => load());

  $('#startBtn').addEventListener('click', async () => {
    try {
      const data = await api('/api/hunt/start', { method: 'POST' });
      player = data.player;
      setTime(data.now);
      startHunt();
    } catch (err) { toast(err.message); }
  });

  /* ---------------- Fotos ---------------- */
  function renderSlots() {
    const box = $('#slots');
    box.replaceChildren(...player.photos.map((url, i) => el('button', {
      class: 'slot' + (url ? ' filled' : ''), type: 'button', 'aria-label': `Foto ${i + 1}`,
      onclick: () => { if (!uploading.has(i)) { slotIndex = i; $('#camera').click(); } },
    },
    el('span', { class: 'num', text: i + 1 }),
    url ? el('img', { src: url, alt: '' }) : [el('span', { class: 'plus', text: '+' }), el('span', { text: 'Foto machen' })],
    uploading.has(i) && el('span', { class: 'spin' }))));
    const n = player.photos.filter(Boolean).length;
    $('#progress').textContent = `${n} von ${player.photoCount} Fotos`;
    $('#finishBtn').textContent = n >= player.photoCount ? 'Abgeben ✓' : `Abgeben (${n}/${player.photoCount})`;
  }

  /** Verkleinert das Foto im Browser (schneller Upload, richtige Drehung). */
  async function shrink(file) {
    const MAX = 1600;
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      const url = URL.createObjectURL(file);
      src = new Image();
      src.src = url;
      await src.decode();
      URL.revokeObjectURL(url);
    }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const k = Math.min(1, MAX / Math.max(w, h));
    const canvas = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Foto konnte nicht verarbeitet werden'))), 'image/jpeg', 0.85));
  }

  $('#camera').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const i = slotIndex;
    uploading.add(i);
    renderSlots();
    try {
      const blob = await shrink(file);
      const data = await api(`/api/hunt/photos/${i}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      player = data.player;
      setTime(data.now);
    } catch (err) {
      toast(err.message || 'Upload fehlgeschlagen – bitte nochmal versuchen');
    } finally {
      uploading.delete(i);
      if (player.status === 'done') showDone(); else renderSlots();
    }
  });

  /* ---------------- Zeit ---------------- */
  function startHunt() {
    bind();
    renderSlots();
    show('hunt');
    clearInterval(timer);
    const tick = () => {
      const left = Math.max(0, player.deadline - serverNow());
      const s = Math.ceil(left / 1000);
      $('#timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('#timer').classList.toggle('low', s <= 30);
      if (left <= 0) {
        clearInterval(timer);
        // laufende Uploads noch abwarten, dann abgeben
        const wait = setInterval(() => { if (!uploading.size) { clearInterval(wait); finish(true); } }, 300);
      }
    };
    tick();
    timer = setInterval(tick, 250);
  }

  async function finish(auto) {
    if (!auto) {
      const n = player.photos.filter(Boolean).length;
      if (uploading.size) return toast('Bitte warte, bis alle Fotos hochgeladen sind.');
      if (n < player.photoCount && !confirm(`Du hast erst ${n} von ${player.photoCount} Fotos. Trotzdem abgeben?`)) return;
    }
    try {
      const data = await api('/api/hunt/finish', { method: 'POST' });
      player = data.player;
    } catch (err) {
      if (!auto) return toast(err.message);
    }
    if (auto) toast('Die Zeit ist abgelaufen!');
    showDone();
  }
  $('#finishBtn').addEventListener('click', () => finish(false));

  function showDone() {
    clearInterval(timer);
    bind();
    $('#donePhotos').replaceChildren(...player.photos.filter(Boolean).map((src) => el('img', { src, alt: '' })));
    show('done');
  }

  /* ---------------- Laden ---------------- */
  async function load() {
    try {
      me = await api('/api/hunt/me');
      setTime(me.now);
      player = me.player;
      $('#eventTitle').textContent = me.title || '';
      document.title = 'Color Hunt – ' + (me.title || '');
      route();
    } catch {
      show('closed');
      toast('Server nicht erreichbar');
    }
  }
  api('/api/state').then((s) => applyTheme(s.settings, null, null)).catch(() => {});
  load();
})();
