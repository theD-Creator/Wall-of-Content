'use strict';
/* Live-Modus: Redaktion schickt Moments (Foto/Video + Text + Hashtags) vom Handy auf die Wall */
(() => {
  const toast = (msg, bad) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 3500);
  };
  const avatar = (u) => (u.avatar
    ? el('img', { class: 'avatar', src: u.avatar, alt: '' })
    : el('span', { class: 'avatar initials', text: u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() }));
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min` : `vor ${Math.floor(m / 60)} Std`; };
  const STATUS = { live: ['● Auf der Wall', 'ok'], pending: ['⏳ Wartet auf Freigabe', 'warn'], hidden: ['Ausgeblendet', ''] };

  let me = null;
  let file = null;
  let suggestions = [];
  const chosen = new Set();

  /* ---------- Anmeldung ---------- */
  let loginUser = null;
  async function showLogin() {
    $('#liveApp').hidden = true;
    $('#liveLogin').hidden = false;
    const { users } = await api('/api/admin/users');
    // Redaktion zuerst, dann die anderen
    users.sort((a, b) => (a.role === 'redaktion' ? -1 : 0) - (b.role === 'redaktion' ? -1 : 0));
    try { loginUser = localStorage.getItem('liveUser'); } catch { /* egal */ }
    if (!users.some((u) => u.id === loginUser)) loginUser = users[0] && users[0].id;
    const pick = (id) => {
      loginUser = id;
      for (const b of $$('#liveUsers button')) b.classList.toggle('selected', b.dataset.id === id);
      $('#livePw').focus();
    };
    $('#liveUsers').replaceChildren(...users.map((u) => el('button', {
      type: 'button', dataset: { id: u.id }, class: u.hasPassword ? '' : 'no-pass', onclick: () => pick(u.id),
    }, avatar(u), el('span', { text: u.name }), el('small', { text: u.role === 'redaktion' ? 'Redaktion' : u.role === 'global' ? 'Global Admin' : 'Admin' }))));
    if (loginUser) pick(loginUser);
  }
  $('#liveLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#liveLoginError').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', json: { userId: loginUser, password: $('#livePw').value } });
      try { localStorage.setItem('liveUser', loginUser); } catch { /* egal */ }
      $('#livePw').value = '';
      start();
    } catch (err) { $('#liveLoginError').textContent = err.message; }
  });
  $('#liveLogout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  /* ---------- Fotos verkleinern, Vorschaubilder ---------- */
  const toBlob = (canvas, q) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
  async function loadImage(f) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { /* Fallback */ }
    }
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    return img;
  }
  async function scaled(src, w, h, max, q) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return toBlob(c, q);
  }
  /** Foto: auf max. 2560 px (scharf genug für jeden Bildschirm, schnell hochgeladen) + Vorschaubild. */
  async function prepareImage(f) {
    const img = await loadImage(f);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    return { body: await scaled(img, w, h, 2560, 0.88), type: 'image/jpeg', thumb: await scaled(img, w, h, 560, 0.8), w, h };
  }
  /** Video: unverändert hochladen, Vorschaubild aus dem ersten Bild. */
  async function prepareVideo(f) {
    const url = URL.createObjectURL(f);
    const v = el('video', { muted: true, playsInline: true, preload: 'auto', src: url });
    let thumb = null, w = 0, h = 0;
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 15000);
        v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 2); };
        v.onseeked = () => { clearTimeout(t); resolve(); };
        v.onerror = () => { clearTimeout(t); reject(new Error('video')); };
      });
      w = v.videoWidth; h = v.videoHeight;
      if (w) thumb = await scaled(v, w, h, 560, 0.8);
    } catch { /* ohne Vorschaubild */ }
    URL.revokeObjectURL(url);
    const type = f.type || (/\.mov$/i.test(f.name) ? 'video/quicktime' : 'video/mp4');
    return { body: f, type, thumb, w, h };
  }

  /* ---------- Hashtags ---------- */
  const norm = (t) => '#' + String(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30);
  function renderTags() {
    const all = [...new Set([...suggestions, ...chosen])];
    $('#tagChips').replaceChildren(...all.map((t) => el('button', {
      type: 'button', class: 'tag-chip' + (chosen.has(t) ? ' on' : ''), text: t,
      onclick: () => { chosen.has(t) ? chosen.delete(t) : chosen.add(t); renderTags(); },
    })));
  }
  $('#tagInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ',' && e.key !== ' ') return;
    e.preventDefault();
    addTypedTag();
  });
  function addTypedTag() {
    const t = norm($('#tagInput').value);
    if (t.length > 1 && chosen.size < 8) chosen.add(t);
    $('#tagInput').value = '';
    renderTags();
  }

  /* ---------- Aufnehmen → Bearbeiten → Posten ---------- */
  for (const input of $$('[data-pick]')) {
    input.addEventListener('change', () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      file = f;
      chosen.clear();
      renderTags();
      $('#caption').value = '';
      const url = URL.createObjectURL(f);
      const isVideo = f.type.startsWith('video/') || /\.(mov|mp4|webm)$/i.test(f.name);
      $('#composePreview').replaceChildren(isVideo
        ? el('video', { src: url, muted: true, playsInline: true, autoplay: true, loop: true, controls: true })
        : el('img', { src: url, alt: '' }));
      $('#pickStep').hidden = true;
      $('#composeStep').hidden = false;
      $('#caption').focus();
    });
  }
  function resetCompose() {
    file = null;
    for (const m of $$('#composePreview img, #composePreview video')) URL.revokeObjectURL(m.src);
    $('#composePreview').replaceChildren();
    $('#composeStep').hidden = true;
    $('#pickStep').hidden = false;
    $('#uploadBar').hidden = true;
    $('#composeSend').disabled = false;
  }
  $('#composeCancel').addEventListener('click', resetCompose);

  function upload(url, body, type) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', type);
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) $('#uploadBar i').style.width = (ev.loaded / ev.total * 100) + '%'; };
      xhr.onload = () => {
        let r = {};
        try { r = JSON.parse(xhr.responseText); } catch { /* leer */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(r); else reject(new Error(r.error || `Fehler ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Keine Verbindung zur Wall – bist du im richtigen WLAN?'));
      xhr.send(body);
    });
  }

  $('#composeStep').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) return;
    if ($('#tagInput').value.trim()) addTypedTag();
    $('#composeSend').disabled = true;
    $('#uploadBar').hidden = false;
    $('#uploadBar i').style.width = '0%';
    try {
      const isVideo = file.type.startsWith('video/') || /\.(mov|mp4|webm)$/i.test(file.name);
      const p = isVideo ? await prepareVideo(file) : await prepareImage(file);
      const q = new URLSearchParams({ caption: $('#caption').value.trim(), tags: [...chosen].join(' '), w: p.w || '', h: p.h || '' });
      const r = await upload('/api/live/moments?' + q, p.body, p.type);
      if (p.thumb) await api(`/api/live/moments/${r.moment.id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: p.thumb }).catch(() => {});
      toast(r.moment.status === 'live' ? '✔ Moment ist auf der Wall!' : '✔ Gesendet – wartet auf Freigabe');
      resetCompose();
      loadMine();
    } catch (err) {
      toast(err.message, true);
      $('#composeSend').disabled = false;
      $('#uploadBar').hidden = true;
    }
  });

  /* ---------- Meine Moments ---------- */
  async function loadMine() {
    const { moments } = await api('/api/live/moments');
    $('#myMoments').replaceChildren(...(moments.length ? moments.map((m) => el('div', { class: 'p-card live-item' },
      el('img', { src: m.thumb || (m.kind === 'video' ? '' : m.url), alt: '' }),
      el('div', {},
        el('b', { text: m.moment.caption || (m.kind === 'video' ? 'Video' : 'Foto') }),
        el('small', { class: 'muted', text: [ago(m.createdAt), ...(m.moment.tags || [])].join(' · ') }),
        el('span', { class: 'live-status ' + STATUS[m.status][1], text: STATUS[m.status][0] })),
      el('button', {
        class: 'btn small danger', type: 'button', text: 'Löschen',
        onclick: async () => {
          if (!confirm('Diesen Moment löschen? Er verschwindet auch von der Wall.')) return;
          await api('/api/live/moments/' + m.id, { method: 'DELETE' }).catch((err) => toast(err.message, true));
          loadMine();
        },
      })))
      : [el('p', { class: 'muted', text: 'Noch keine Moments. Mach das erste Foto!' })]));
  }

  async function start() {
    try {
      me = await api('/api/live/me');
    } catch {
      return showLogin();
    }
    suggestions = me.tags || [];
    $('#liveLogin').hidden = true;
    $('#liveApp').hidden = false;
    $('#liveEvent').textContent = me.title || 'Live-Modus';
    $('#liveHello').textContent = `Hallo ${me.user.name}! Was du hier aufnimmst, erscheint als Moment auf der Wall.`;
    $('#approvalNote').hidden = !me.approval;
    renderTags();
    loadMine().catch(() => {});
  }

  api('/api/state').then((s) => applyTheme(s.settings, s.backgroundUrl, null)).catch(() => {});
  start();
})();
