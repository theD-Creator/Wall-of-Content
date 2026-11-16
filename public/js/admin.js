'use strict';
/* Admin-Panel */
(() => {
  let data = null;
  let photoFilter = 'all';
  let events = null;

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!isError);
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  async function call(url, options) {
    try {
      return await api(url, options);
    } catch (e) {
      if (e.status === 401) showLogin();
      else toast(e.message, true);
      throw e;
    }
  }

  /* ---------------- Anmeldung ---------------- */
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#password').focus();
    if (events) { events.close(); events = null; }
  }
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', json: { password: $('#password').value } });
      $('#password').value = '';
      start();
    } catch (err) {
      $('#loginError').textContent = err.message;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  /* ---------------- Tabs ---------------- */
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    for (const b of $$('#tabs button')) b.classList.toggle('active', b === btn);
    for (const p of $$('.panel')) p.classList.toggle('active', p.dataset.panel === btn.dataset.tab);
  });

  /* ---------------- Darstellung ---------------- */
  const fmtTime = (ts) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function renderOverview() {
    const media = data.items.filter((i) => i.kind !== 'photo');
    const photos = data.items.filter((i) => i.kind === 'photo');
    const stat = (n, label) => el('div', { class: 'card stat' }, el('b', { text: n }), el('span', { text: label }));
    $('#stats').replaceChildren(
      stat(data.items.filter((i) => i.onWall).length, 'Inhalte auf der Wall'),
      stat(media.length, 'Bilder & Videos'),
      stat(photos.length, 'Fotos von Stationen'),
      stat(data.devices.filter((d) => d.role === 'station').length, 'Stationen online'));

    const urlRow = (label, url, hint) => el('div', { class: 'url' },
      el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code', class: 'url-qr' }),
      el('div', {}, el('b', { text: label }), el('a', { href: url, target: '_blank', rel: 'noopener', text: url }), el('small', { class: 'muted', text: hint })));
    $('#urls').replaceChildren(
      urlRow('Wall (großer Bildschirm)', data.urls.wall, 'Im Browser öffnen, Taste F = Vollbild.'),
      urlRow('Fotostation (Handy/Tablet)', data.urls.station, 'QR-Code mit dem Stations-Handy scannen. Zertifikatswarnung einmalig bestätigen, damit die Kamera funktioniert.'));
    $('#stationsEnabled').checked = data.settings.stationsEnabled;
    renderDevices();
  }

  function renderDevices() {
    const list = data.devices;
    $('#devices').replaceChildren(...(list.length
      ? list.map((d) => el('li', {}, el('span', { class: 'dot' }), el('b', { text: d.name }),
        el('span', { class: 'muted', text: ` ${d.role === 'wall' ? 'Wall' : 'Fotostation'} · seit ${fmtTime(d.since)}` })))
      : [el('li', { class: 'muted', text: 'Keine Wall und keine Station verbunden.' })]));
  }

  function itemCard(item) {
    const isPhoto = item.kind === 'photo';
    const pending = isPhoto && item.shared && !item.reviewed;
    const preview = item.thumb || item.kind !== 'video'
      ? el('img', { src: item.thumb || item.url, alt: '', loading: 'lazy' })
      : el('video', { src: item.url + '#t=0.5', muted: true, preload: 'metadata' });
    const status = !isPhoto ? null
      : !item.shared ? el('span', { class: 'tag', text: 'Nicht geteilt' })
        : pending ? el('span', { class: 'tag warn', text: 'Wartet auf Freigabe' }) : null;

    const toggle = el('label', { class: 'switch' },
      el('input', {
        type: 'checkbox', checked: item.onWall, disabled: isPhoto && !item.shared,
        onchange: (e) => call(`/api/admin/items/${item.id}`, { method: 'PATCH', json: { onWall: e.target.checked } }).then(load, load),
      }), el('span'), ' Auf der Wall');

    return el('div', { class: 'item' + (item.onWall ? ' on' : '') },
      el('a', { class: 'item-media', href: item.url, target: '_blank', rel: 'noopener' }, preview,
        item.kind === 'video' && el('span', { class: 'bubble-play', text: '▶' }), status),
      el('div', { class: 'item-body' },
        isPhoto
          ? el('div', { class: 'muted small', text: `${fmtTime(item.createdAt)}${item.station ? ' · ' + item.station : ''}${item.frame ? ' · ' + item.frame : ''}` })
          : el('input', {
            class: 'title-input', value: item.title, placeholder: 'Titel (optional)', maxLength: 80,
            onchange: (e) => call(`/api/admin/items/${item.id}`, { method: 'PATCH', json: { title: e.target.value } }),
          }),
        toggle,
        el('div', { class: 'row' },
          item.onWall && el('button', {
            class: 'btn small', text: 'Jetzt zeigen',
            onclick: () => call('/api/admin/command', { method: 'POST', json: { action: 'show', id: item.id } }).then(() => toast('Wird auf der Wall gezeigt')),
          }),
          isPhoto && el('a', { class: 'btn small', href: `/p/${item.id}`, target: '_blank', rel: 'noopener', text: 'Download-Seite' }),
          el('button', {
            class: 'btn small danger', text: 'Löschen',
            onclick: () => confirm('Wirklich löschen?') && call(`/api/admin/items/${item.id}`, { method: 'DELETE' }).then(load),
          }))));
  }

  function renderItems() {
    const media = data.items.filter((i) => i.kind !== 'photo');
    $('#mediaGrid').replaceChildren(...(media.length ? media.map(itemCard) : [el('p', { class: 'muted', text: 'Noch keine Inhalte hochgeladen.' })]));

    const photos = data.items.filter((i) => i.kind === 'photo');
    const pending = photos.filter((i) => i.shared && !i.reviewed);
    const shown = photos.filter((i) => photoFilter === 'all' ? true
      : photoFilter === 'pending' ? pending.includes(i)
        : photoFilter === 'wall' ? i.onWall : !i.shared);
    $('#photoGrid').replaceChildren(...(shown.length ? shown.map(itemCard) : [el('p', { class: 'muted', text: 'Keine Fotos.' })]));
    $('#pendingBadge').hidden = !pending.length;
    $('#pendingBadge').textContent = pending.length;
  }
  $('.filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    photoFilter = chip.dataset.filter;
    for (const c of $$('.filter .chip')) c.classList.toggle('active', c === chip);
    renderItems();
  });

  function assetCard(kind, a) {
    const url = `/api/admin/assets/${kind}/${encodeURIComponent(a.file)}`;
    const isBg = kind === 'backgrounds';
    const active = isBg && data.settings.background === a.file;
    return el('div', { class: 'item' + ((isBg ? active : a.enabled) ? ' on' : '') },
      el('div', { class: 'item-media ' + (isBg ? 'bg' : 'checker') }, el('img', { src: a.url, alt: a.name, loading: 'lazy' })),
      el('div', { class: 'item-body' },
        el('input', {
          class: 'title-input', value: a.name, maxLength: 60,
          onchange: (e) => call(url, { method: 'PATCH', json: { name: e.target.value } }),
        }),
        isBg
          ? el('button', {
            class: 'btn small' + (active ? ' primary' : ''), text: active ? '✓ Aktiv' : 'Verwenden',
            onclick: () => call('/api/admin/settings', { method: 'PUT', json: { background: active ? '' : a.file } }).then(load),
          })
          : el('label', { class: 'switch' }, el('input', {
            type: 'checkbox', checked: a.enabled,
            onchange: (e) => call(url, { method: 'PATCH', json: { enabled: e.target.checked } }).then(load, load),
          }), el('span'), ' An der Station verfügbar'),
        el('button', {
          class: 'btn small danger', text: 'Löschen',
          onclick: () => confirm(`„${a.name}“ wirklich löschen?`) && call(url, { method: 'DELETE' }).then(load),
        })));
  }
  function renderAssets() {
    for (const kind of ['frames', 'backgrounds']) {
      const list = data[kind];
      $(`#${kind}Grid`).replaceChildren(...(list.length ? list.map((a) => assetCard(kind, a)) : [el('p', { class: 'muted', text: 'Noch nichts vorhanden.' })]));
    }
  }

  /* ---------------- Einstellungen ---------------- */
  const form = $('#settingsForm');
  function renderSettings() {
    if (form.contains(document.activeElement)) return; // nicht beim Tippen überschreiben
    for (const input of form.elements) {
      if (!input.name || !(input.name in data.settings)) continue;
      if (input.type === 'checkbox') input.checked = data.settings[input.name];
      else input.value = data.settings[input.name];
      if (input.type === 'range') input.nextElementSibling.textContent = input.value + '×';
    }
  }
  form.addEventListener('input', (e) => {
    if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value + '×';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const json = {};
    for (const input of form.elements) {
      if (!input.name) continue;
      json[input.name] = input.type === 'checkbox' ? input.checked
        : input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
    }
    document.activeElement.blur();
    await call('/api/admin/settings', { method: 'PUT', json });
    toast('Einstellungen gespeichert');
    load();
  });
  $('#stationsEnabled').addEventListener('change', (e) => {
    call('/api/admin/settings', { method: 'PUT', json: { stationsEnabled: e.target.checked } }).then(load, load);
  });
  for (const btn of $$('[data-cmd]')) {
    btn.addEventListener('click', () => call('/api/admin/command', { method: 'POST', json: { action: btn.dataset.cmd, target: btn.dataset.target } }).then(() => toast('Gesendet')));
  }

  /* ---------------- Uploads ---------------- */
  function upload(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* leer */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error((body && body.error) || `Fehler ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'));
      xhr.send(file);
    });
  }

  /** Erzeugt im Browser ein kleines Vorschaubild (JPEG) für Bild oder Video. */
  async function makeThumb(file) {
    const MAX = 560;
    const draw = (src, w, h) => {
      const k = Math.min(1, MAX / Math.max(w, h));
      const canvas = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
      return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    };
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith('video/')) {
        const video = el('video', { muted: true, playsInline: true, preload: 'auto', src: url });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 10000);
          video.onloadeddata = () => { video.currentTime = Math.min(1, (video.duration || 2) / 2); };
          video.onseeked = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error('video')); };
        });
        return await draw(video, video.videoWidth, video.videoHeight);
      }
      const img = new Image();
      img.src = url;
      await img.decode();
      return await draw(img, img.naturalWidth, img.naturalHeight);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadMedia(files) {
    for (const file of files) {
      const bar = el('i');
      const row = el('div', { class: 'upload' }, el('span', { text: file.name }), el('div', { class: 'progress' }, bar));
      $('#uploads').append(row);
      try {
        const res = await upload('/api/admin/media?name=' + encodeURIComponent(file.name), file, (p) => { bar.style.width = (p * 100) + '%'; });
        const thumb = await makeThumb(file);
        if (thumb) await api(`/api/admin/items/${res.item.id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumb });
        row.remove();
      } catch (e) {
        row.classList.add('failed');
        row.append(el('small', { text: ' ' + e.message }));
        setTimeout(() => row.remove(), 8000);
      }
    }
    load();
  }
  $('#mediaInput').addEventListener('change', (e) => { uploadMedia([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => uploadMedia([...e.dataTransfer.files]));

  for (const input of $$('input[data-asset]')) {
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        try {
          await upload(`/api/admin/assets/${input.dataset.asset}?name=${encodeURIComponent(file.name)}`, file);
        } catch (e) { toast(`${file.name}: ${e.message}`, true); }
      }
      input.value = '';
      load();
    });
  }

  /* ---------------- Laden ---------------- */
  let loading = null;
  function load() {
    // mehrere Auslöser kurz hintereinander zusammenfassen
    loading = loading || new Promise((r) => setTimeout(r, 80)).then(async () => {
      loading = null;
      data = await call('/api/admin/overview');
      renderOverview(); renderItems(); renderAssets(); renderSettings();
    }).catch(() => { loading = null; });
    return loading;
  }

  async function start() {
    const me = await api('/api/admin/me');
    if (!me.admin) return showLogin();
    $('#login').hidden = true;
    $('#app').hidden = false;
    await load();
    if (events) events.close();
    events = connectEvents('admin', 'Admin', {
      items: load, settings: load, reconnect: load,
      devices: (d) => { if (data) { data.devices = d.devices; renderOverview(); } },
    });
  }
  start();
})();
