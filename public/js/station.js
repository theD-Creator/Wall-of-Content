'use strict';
/* Fotostation: Start -> Rahmen wählen -> Foto -> Kontrolle -> QR-Code */
(() => {
  const DEFAULT_SIZE = { w: 1080, h: 1920 };   // Hochformat 9:16, falls kein Rahmen gewählt ist
  const MAX_SIDE = 1800;
  const IDLE_MS = 90_000;

  const video = $('#video');
  const preview = $('#preview');
  const overlay = $('#frameOverlay');
  const fileInput = $('#fileInput');

  let settings = {};
  let frames = [];
  let frame = null;            // gewählter Rahmen oder null
  let stream = null;
  let facing = 'user';
  let photoBlob = null;
  let busy = false;
  let screen = 'start';
  let idleTimer = null;
  let qrTimer = null;
  const liveCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // Name der Station (für das Admin-Panel): ?name=… oder zufällig, wird gemerkt
  const params = new URLSearchParams(location.search);
  let stationName = params.get('name');
  try {
    if (stationName) localStorage.setItem('stationName', stationName);
    else stationName = localStorage.getItem('stationName');
    if (!stationName) {
      stationName = 'Station ' + Math.floor(100 + Math.random() * 900);
      localStorage.setItem('stationName', stationName);
    }
  } catch { stationName = stationName || 'Station'; }
  $('#stationName').textContent = stationName;

  /* ---------------- Navigation ---------------- */
  function show(name) {
    screen = name;
    for (const s of $$('.screen')) s.classList.toggle('active', s.dataset.screen === name);
    clearInterval(qrTimer);
    if (name !== 'shoot') stopCamera();
    resetIdle();
  }
  function home() {
    photoBlob = null;
    URL.revokeObjectURL($('#result').src);
    $('#result').removeAttribute('src');
    show(settings.stationsEnabled === false ? 'paused' : 'start');
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    if (screen === 'shoot' || screen === 'review') idleTimer = setTimeout(home, IDLE_MS);
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, resetIdle, { passive: true });

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /* ---------------- Kamera ---------------- */
  async function startCamera() {
    $('#camError').hidden = true;
    if (!liveCamera) {
      // Ohne HTTPS gibt der Browser die Live-Kamera nicht frei -> Kamera-App des Handys nutzen
      showCamError('Tippe auf den Auslöser, um die Kamera zu öffnen.');
      return;
    }
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      $('#switchCam').hidden = cams.length < 2;
    } catch (e) {
      stream = null;
      showCamError(e.name === 'NotAllowedError'
        ? 'Kein Zugriff auf die Kamera. Bitte erlaube die Kamera im Browser – oder tippe auf den Auslöser, um die Kamera-App zu nutzen.'
        : 'Kamera nicht verfügbar. Tippe auf den Auslöser, um die Kamera-App zu nutzen.');
    }
  }
  function stopCamera() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
  }
  function showCamError(msg) {
    const box = $('#camError');
    box.textContent = msg;
    box.hidden = false;
  }
  $('#switchCam').addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    startCamera();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if (screen === 'shoot') startCamera();
  });

  /* ---------------- Rahmen ---------------- */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
      img.src = src;
    });
  }
  function outputSize(img) {
    let w = img ? img.naturalWidth : DEFAULT_SIZE.w;
    let h = img ? img.naturalHeight : DEFAULT_SIZE.h;
    if (!w || !h) ({ w, h } = DEFAULT_SIZE);
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  /** Deckende Bilder sind Hintergründe (Foto kommt in ein Fenster), transparente liegen über dem Foto. */
  function isOpaque(img) {
    try {
      const c = el('canvas', { width: 9, height: 9 });
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 9, 9);
      return ctx.getImageData(4, 4, 1, 1).data[3] > 250;
    } catch { return false; }
  }
  /** Fotofenster in Pixeln für eine Ausgabegröße – oder null, wenn der Rahmen über dem Foto liegt. */
  function photoWindow(w, h) {
    if (!frame || !frame.opaque) return null;
    const x = w * settings.photoX / 100, y = h * settings.photoY / 100;
    return {
      x, y,
      w: Math.min(w - x, w * settings.photoW / 100),
      h: Math.min(h - y, h * settings.photoH / 100),
      r: w * settings.photoRadius / 100,
    };
  }
  function layoutPreview() {
    const size = outputSize(frame && frame.img);
    const win = photoWindow(size.w, size.h);
    preview.classList.toggle('windowed', !!win);
    const st = video.style;
    if (win) {
      st.left = (win.x / size.w * 100) + '%';
      st.top = (win.y / size.h * 100) + '%';
      st.width = (win.w / size.w * 100) + '%';
      st.height = (win.h / size.h * 100) + '%';
      st.borderRadius = `${win.r / win.w * 100}% / ${win.r / win.h * 100}%`;
    } else {
      st.left = st.top = '0'; st.width = st.height = '100%'; st.borderRadius = '0';
    }
  }

  async function selectFrame(f) {
    frame = f;
    for (const b of $$('.frame-thumb')) b.classList.toggle('selected', b.dataset.file === (f ? f.file : ''));
    if (f) {
      try { f.img = f.img || await loadImage(f.url); f.opaque = isOpaque(f.img); } catch { toast('Rahmen konnte nicht geladen werden'); frame = null; }
    }
    if (frame !== f && f) return selectFrame(null);
    const size = outputSize(frame && frame.img);
    preview.style.aspectRatio = `${size.w} / ${size.h}`;
    preview.style.setProperty('--ratio', size.w / size.h);
    overlay.hidden = !frame;
    if (frame) overlay.src = frame.url;
    layoutPreview();
  }

  function renderFrames() {
    const box = $('#frames');
    const thumb = (f) => el('button', {
      class: 'frame-thumb', role: 'option', dataset: { file: f ? f.file : '' }, onclick: () => selectFrame(f),
    }, f ? el('img', { src: f.url, alt: f.name }) : el('span', { class: 'no-frame', text: 'Ohne' }), el('small', { text: f ? f.name : 'Kein Rahmen' }));
    box.replaceChildren(...frames.map(thumb), thumb(null));
    const keep = frame && frames.find((f) => f.file === frame.file);
    selectFrame(keep || frames[0] || null);
  }

  /* ---------------- Aufnahme ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Zeichnet Quelle (Video/Bild) formatfüllend + Rahmen auf eine Leinwand. */
  function compose(source, sw, sh, mirror) {
    const { w, h } = outputSize(frame && frame.img);
    const canvas = el('canvas', { width: w, height: h });
    const ctx = canvas.getContext('2d');
    const win = photoWindow(w, h);
    const box = win || { x: 0, y: 0, w, h, r: 0 };
    if (win) ctx.drawImage(frame.img, 0, 0, w, h);
    const scale = Math.max(box.w / sw, box.h / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.save();
    if (win) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, box.r); else ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
    }
    if (mirror) { ctx.translate(2 * box.x + box.w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    ctx.restore();
    if (!win && frame && frame.img) ctx.drawImage(frame.img, 0, 0, w, h);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(Object.assign(b, { w, h })) : reject(new Error('Foto konnte nicht erstellt werden'))), 'image/jpeg', 0.9));
  }

  async function shoot() {
    if (busy) return;
    if (!stream || !video.videoWidth) { fileInput.click(); return; }
    busy = true;
    try {
      const count = $('#count');
      for (let n = settings.countdown ?? 3; n > 0; n--) {
        count.hidden = false;
        count.textContent = n;
        count.classList.remove('pop');
        void count.offsetWidth;
        count.classList.add('pop');
        await sleep(1000);
        if (screen !== 'shoot') return;
      }
      count.hidden = true;
      if (!stream || !video.videoWidth) throw new Error('Kamera nicht bereit');
      const flash = $('#flash');
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      photoBlob = await compose(video, video.videoWidth, video.videoHeight, facing === 'user');
      review();
    } catch (e) {
      toast(e.message);
    } finally {
      $('#count').hidden = true;
      busy = false;
    }
  }

  // Ersatzweg ohne Live-Kamera: Foto aus der Kamera-App des Handys
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      let src, w, h;
      if (window.createImageBitmap) {
        src = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
        w = src.width; h = src.height;
      } else {
        const url = URL.createObjectURL(file);
        src = await loadImage(url);
        URL.revokeObjectURL(url);
        w = src.naturalWidth; h = src.naturalHeight;
      }
      photoBlob = await compose(src, w, h, false);
      review();
    } catch (e) {
      toast('Das Foto konnte nicht verarbeitet werden');
    }
  });

  function review() {
    URL.revokeObjectURL($('#result').src);
    $('#result').src = URL.createObjectURL(photoBlob);
    $('#share').checked = !!settings.shareDefault;
    show('review');
  }

  async function savePhoto() {
    if (busy || !photoBlob) return;
    busy = true;
    $('#busy').hidden = false;
    try {
      const q = new URLSearchParams({ share: $('#share').checked ? '1' : '0', station: stationName, frame: frame ? frame.name : '', w: photoBlob.w || '', h: photoBlob.h || '' });
      const data = await api('/api/photos?' + q, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photoBlob });
      $('#qrImg').src = data.qr;
      $('#qrPhoto').src = data.url;
      $('#qrNote').textContent = data.onWall ? '✨ Dein Foto erscheint jetzt auf der Wall of Content!'
        : data.pending ? '✨ Dein Foto erscheint nach der Freigabe auf der Wall of Content.' : '';
      photoBlob = null;
      show('qr');
      let left = settings.qrTimeout || 60;
      $('#qrLeft').textContent = left;
      qrTimer = setInterval(() => {
        $('#qrLeft').textContent = --left;
        if (left <= 0) home();
      }, 1000);
    } catch (e) {
      toast(e.message || 'Speichern fehlgeschlagen – bitte nochmal versuchen');
    } finally {
      $('#busy').hidden = true;
      busy = false;
    }
  }

  /* ---------------- Bedienung ---------------- */
  async function begin() {
    show('shoot');
    await startCamera();
  }
  $('#startBtn').addEventListener('click', begin);
  $('#shootBtn').addEventListener('click', shoot);
  $('#retakeBtn').addEventListener('click', begin);
  $('#saveBtn').addEventListener('click', savePhoto);
  $('#doneBtn').addEventListener('click', home);
  for (const b of $$('[data-action="home"]')) b.addEventListener('click', home);

  // Bildschirm wach halten
  let wakeLock = null;
  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
  addEventListener('pointerdown', () => { if (!wakeLock || wakeLock.released) keepAwake(); }, { passive: true });

  /* ---------------- Daten ---------------- */
  async function loadState() {
    const state = await api('/api/state');
    settings = state.settings;
    applyTheme(settings, state.backgroundUrl, state.logoUrl);
    $('#stationTitle').textContent = settings.stationTitle || 'Fotostation';
    $('#stationSub').textContent = settings.title || '';
    document.title = settings.stationTitle || 'Fotostation';
    const changed = JSON.stringify(state.frames.map((f) => f.file + f.name)) !== JSON.stringify(frames.map((f) => f.file + f.name));
    if (changed || !$('#frames').children.length) {
      frames = state.frames;
      renderFrames();
      // alle Rahmen vorab laden, damit der Wechsel beim Antippen sofort sichtbar ist
      for (const f of frames) { const img = new Image(); img.decoding = 'async'; img.src = f.url; }
    }
    layoutPreview();
    if (settings.stationsEnabled === false) { if (screen !== 'paused') show('paused'); }
    else if (screen === 'paused') show('start');
  }

  connectEvents('station', stationName, {
    settings: () => loadState().catch(() => {}),
    reconnect: () => loadState().catch(() => {}),
    command: (c) => { if (c.action === 'reload') location.reload(); },
  });
  Fullscreen.install();
  loadState().catch(() => toast('Server nicht erreichbar'));
})();
