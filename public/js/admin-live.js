'use strict';
/* Admin-Panel: Bühne (Playlist, Anpinnen, Ausblenden, „Jetzt auf die Bühne“) und Moments (Live-Modus der Redaktion) */
(() => {
  const { call, toast } = window.adminApi;
  let data = null;
  let filter = 'alle';
  const KIND = { photo: '📸', image: '🖼️', video: '🎬' };
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min` : m < 1440 ? `vor ${Math.floor(m / 60)} Std` : new Date(ms).toLocaleDateString('de-DE'); };
  const preview = (it) => (it.kind === 'video' ? VideoPreview.make(it) : el('img', { src: it.thumb || it.url, alt: '', loading: 'lazy' }));
  const label = (it) => (it.moment && it.moment.caption) || it.title || (it.kind === 'photo' ? 'Foto' : it.kind === 'video' ? 'Video' : 'Bild');

  /* ---------- Einstellungen mit data-setting (Schalter, Regler, Auswahl, Text) ---------- */
  async function saveSetting(input) {
    const key = input.dataset.setting;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    try {
      await call('/api/admin/settings', { method: 'PUT', json: { [key]: value } });
      toast('Gespeichert');
    } catch { window.adminApi.load(); }
  }
  for (const input of $$('[data-setting]')) {
    const ev = input.type === 'range' ? 'change' : input.tagName === 'INPUT' && input.type !== 'checkbox' && input.type !== 'radio' ? 'change' : 'change';
    input.addEventListener(ev, () => saveSetting(input));
    if (input.type === 'range') input.addEventListener('input', () => { const o = input.nextElementSibling; if (o) o.textContent = input.value + (input.dataset.unit || ''); });
  }
  function fillSettings(s) {
    for (const input of $$('[data-setting]')) {
      if (input === document.activeElement) continue;
      const v = s[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = !!v;
      else if (input.type === 'radio') input.checked = input.value === v;
      else input.value = v ?? '';
      if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.textContent = input.value + (input.dataset.unit || '');
    }
  }

  const patch = (it, json) => call(`/api/admin/items/${it.id}`, { method: 'PATCH', json }).then(() => window.adminApi.load());
  const toStage = (it) => call('/api/admin/command', { method: 'POST', json: { action: 'stage', id: it.id } }).then(() => toast('Läuft jetzt auf der Bühne'));

  /* ---------- Playlist ---------- */
  let dragId = null;
  function saveOrder(ids) {
    return call('/api/admin/stage/order', { method: 'PUT', json: { ids } }).then(() => window.adminApi.load());
  }
  function renderPlaylist(items) {
    const list = items.filter((i) => i.pin && i.onWall).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    $('#playlistCount').textContent = list.length ? `${list.length} Inhalte` : '';
    const ids = list.map((i) => i.id);
    const move = (id, d) => {
      const n = ids.indexOf(id);
      const m = n + d;
      if (m < 0 || m >= ids.length) return;
      [ids[n], ids[m]] = [ids[m], ids[n]];
      saveOrder(ids);
    };
    $('#playlist').replaceChildren(...(list.length ? list.map((it, n) => el('li', {
      class: 'pl-item', draggable: true, dataset: { id: it.id },
      ondragstart: (e) => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => e.currentTarget.classList.remove('dragging'),
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: (e) => e.currentTarget.classList.remove('over'),
      ondrop: (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('over');
        if (!dragId || dragId === it.id) return;
        const from = ids.indexOf(dragId);
        ids.splice(from, 1);
        ids.splice(ids.indexOf(it.id) + (from <= n ? 1 : 0), 0, dragId);
        saveOrder(ids);
      },
    },
    el('span', { class: 'pl-num', text: n + 1 }),
    el('span', { class: 'pl-thumb' }, preview(it)),
    el('span', { class: 'pl-title' }, el('b', { text: label(it) }), el('small', { class: 'muted', text: (KIND[it.kind] || '') + ' ' + ago(it.createdAt) })),
    el('span', { class: 'pl-actions' },
      el('button', { class: 'btn small', type: 'button', text: '↑', title: 'Nach oben', disabled: n === 0, onclick: () => move(it.id, -1) }),
      el('button', { class: 'btn small', type: 'button', text: '↓', title: 'Nach unten', disabled: n === list.length - 1, onclick: () => move(it.id, 1) }),
      el('button', { class: 'btn small primary', type: 'button', text: '▶ Jetzt', onclick: () => toStage(it) }),
      el('button', { class: 'btn small', type: 'button', text: '✕', title: 'Aus der Playlist', onclick: () => patch(it, { stagePin: false }) }))))
      : [el('li', { class: 'muted small', text: 'Noch nichts angepinnt. Unten bei einem Inhalt auf „📌 Anpinnen“ tippen.' })]));
  }

  /* ---------- Alle Inhalte ---------- */
  const FILTERS = [['alle', 'Alle'], ['photo', '📸 Fotostation'], ['image', '🖼️ Bilder'], ['video', '🎬 Videos'], ['moment', '📍 Moments'], ['hidden', '🙈 Ausgeblendet']];
  function renderStageItems(items) {
    $('#stageFilter').replaceChildren(...FILTERS.map(([k, t]) => el('button', {
      type: 'button', class: 'chip' + (filter === k ? ' active' : ''), text: t, onclick: () => { filter = k; renderStageItems(items); },
    })));
    const list = items.filter((i) => i.onWall).filter((i) => filter === 'alle' ? true
      : filter === 'moment' ? !!i.moment : filter === 'hidden' ? i.stageHide : filter === 'image' ? i.kind === 'image' && !i.moment : i.kind === filter);
    $('#stageItems').replaceChildren(...(list.length ? list.map((it) => el('div', { class: 'stage-item' + (it.stageHide ? ' off' : '') + (it.pin ? ' pinned' : '') },
      el('div', { class: 'stage-thumb' }, preview(it), it.pin && el('span', { class: 'pin-badge', text: '📌' })),
      el('b', { text: label(it) }),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn small' + (it.pin ? ' on' : ''), type: 'button', text: it.pin ? '📌 Angepinnt' : '📌 Anpinnen', onclick: () => patch(it, { stagePin: !it.pin }) }),
        el('button', { class: 'btn small', type: 'button', text: it.stageHide ? '🙈 Bühne: aus' : '👁 Bühne: an', title: 'Nur für die Bühne ausblenden (bleibt im Mosaik und unter „Alle Inhalte“)', onclick: () => patch(it, { stageHide: !it.stageHide }) }),
        el('button', { class: 'btn small primary', type: 'button', text: '▶ Jetzt', onclick: () => toStage(it) }))))
      : [el('p', { class: 'muted', text: 'Keine Inhalte in dieser Auswahl.' })]));
  }

  /* ---------- Moments ---------- */
  function renderMoments(items) {
    const list = items.filter((i) => i.moment).sort((a, b) => b.createdAt - a.createdAt);
    const pending = list.filter((i) => !i.onWall && i.reviewed === false).length;
    $('#momentBadge').hidden = !pending;
    $('#momentBadge').textContent = pending;
    $('#momentList').replaceChildren(...(list.length ? list.map((it) => {
      const cap = el('input', { value: it.moment.caption || '', maxLength: 200, placeholder: 'Bildunterschrift' });
      const tags = el('input', { value: (it.moment.tags || []).join(' '), placeholder: '#Hashtags' });
      const state = it.onWall ? ['● Auf der Wall', 'done'] : it.reviewed === false ? ['⏳ Wartet auf Freigabe', 'running'] : ['Ausgeblendet', ''];
      return el('div', { class: 'moment-row' + (it.reviewed === false && !it.onWall ? ' pending' : '') },
        el('div', { class: 'stage-thumb' }, preview(it)),
        el('div', { class: 'moment-body' },
          el('div', { class: 'row wrap' }, el('b', { text: it.moment.by }), el('span', { class: 'muted small', text: ago(it.createdAt) }),
            el('span', { class: 'status ' + state[1], text: state[0] })),
          cap, tags,
          el('div', { class: 'row wrap' },
            el('button', { class: 'btn small', type: 'button', text: 'Text speichern', onclick: () => patch(it, { caption: cap.value, tags: tags.value.split(/[\s,]+/).filter(Boolean) }).then(() => toast('Gespeichert')) }),
            it.onWall
              ? el('button', { class: 'btn small', type: 'button', text: 'Von der Wall nehmen', onclick: () => patch(it, { onWall: false }) })
              : el('button', { class: 'btn small primary', type: 'button', text: it.reviewed === false ? '✔ Freigeben' : 'Wieder zeigen', onclick: () => patch(it, { onWall: true }) }),
            it.onWall && el('button', { class: 'btn small', type: 'button', text: '▶ Jetzt auf die Bühne', onclick: () => toStage(it) }),
            el('button', {
              class: 'btn small danger', type: 'button', text: 'Löschen',
              onclick: () => confirm('Diesen Moment löschen?') && call(`/api/admin/items/${it.id}`, { method: 'DELETE' }).then(() => window.adminApi.load()),
            }))));
    }) : [el('p', { class: 'muted', text: 'Noch keine Moments. Die Redaktion postet sie unter /live.' })]));
  }

  function render(d) {
    data = d;
    if (!data) return;
    fillSettings(data.settings);
    renderPlaylist(data.items);
    renderStageItems(data.items);
    renderMoments(data.items);
    const url = data.urls && data.urls.live;
    if (url && $('#liveUrl').textContent !== url) {
      $('#liveUrl').textContent = url;
      $('#liveQr').src = '/api/admin/qr.svg?text=' + encodeURIComponent(url);
    }
  }
  for (const a of $$('[data-goto]')) a.addEventListener('click', (e) => { e.preventDefault(); $(`#tabs [data-tab="${a.dataset.goto}"]`).click(); });
  (window.adminExtensions ||= []).push(render);
})();
