'use strict';
/* Admin-Panel: Programm, Challenges, Shop und Feedback der Besucher-App (Daten: /api/admin/portal) */
(() => {
  const { call, toast, load, fmtTime } = window.adminApi;
  let data = null;

  // Validierte Farben (Kontrast auf der dunklen Kartenfläche geprüft):
  // eine Serie = Akzentfarbe; geordnete Stufen (Bewertung 1–5, Anzahl Stationen) = eine Farbe von dunkel nach hell
  // Farben kommen aus dem Design (neu.css: --chart-*); Standard = klassisches dunkles Design
  const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const RAMP_DARK = ['#8f2a5d', '#b02f6a', '#d33a7d', '#ef6a9f', '#fca5c6'];
  const series = () => cssVar('--chart-series', '#e10b70');
  const ramp = () => RAMP_DARK.map((c, i) => cssVar(`--chart-ramp-${i + 1}`, c));
  const rampAt = (t) => { const r = ramp(); return `color-mix(in oklch, ${r[0]} ${Math.round((1 - t) * 100)}%, ${r[4]})`; };
  const SMILEYS = ['', '😖', '🙁', '😐', '🙂', '😍'];
  const RATING = ['', 'Sehr schlecht', 'Schlecht', 'Okay', 'Gut', 'Sehr gut'];

  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (ms) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const notTyping = (box) => !(box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));

  /** Waagerechte Balken: [{ label, value, color, tip }] – Werte stehen als Text daneben. */
  function hbars(box, rows, emptyText) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    if (!rows.length || rows.every((r) => !r.value)) {
      box.replaceChildren(el('p', { class: 'muted small', text: emptyText }));
      return;
    }
    box.replaceChildren(...rows.map((r) => el('div', { class: 'hbar', 'data-tip': r.tip, tabindex: 0, 'aria-label': r.tip },
      el('span', { class: 'hbar-label', text: r.label }),
      el('span', { class: 'hbar-track' }, el('i', { style: `width:${Math.max(r.value ? 2 : 0, r.value / max * 100)}%;background:${r.color}` })),
      el('span', { class: 'hbar-value', text: r.value }))));
  }
  const qrImg = (url) => el('img', { class: 'mini-qr', src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code' });

  /* ======================= Programm ======================= */
  const pForm = $('#progForm');
  let editingProg = null;
  function resetProgForm() {
    editingProg = null;
    pForm.reset();
    const last = data && [...data.portal.program].sort((a, b) => b.start - a.start)[0];
    pForm.elements.date.value = toDate(last ? last.start : Date.now());
    $('#progFormTitle').textContent = 'Neuer Programmpunkt';
    $('#progCancel').hidden = true;
  }
  $('#progCancel').addEventListener('click', resetProgForm);
  pForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pForm.elements;
    const start = new Date(`${f.date.value}T${f.start.value}`).getTime();
    let end = new Date(`${f.date.value}T${f.end.value}`).getTime();
    if (end <= start) end += 86400_000; // über Mitternacht
    const json = { title: f.title.value, description: f.description.value, start, end, highlight: f.highlight.checked };
    try {
      if (editingProg) await call(`/api/admin/program/${editingProg}`, { method: 'PUT', json });
      else await call('/api/admin/program', { method: 'POST', json });
      toast(editingProg ? 'Programmpunkt gespeichert' : 'Programmpunkt hinzugefügt');
      document.activeElement.blur();
      resetProgForm();
      load();
    } catch { /* Meldung kommt aus call() */ }
  });
  function editProg(p) {
    editingProg = p.id;
    const f = pForm.elements;
    f.title.value = p.title;
    f.description.value = p.description || '';
    f.date.value = toDate(p.start);
    f.start.value = toTime(p.start);
    f.end.value = toTime(p.end);
    f.highlight.checked = !!p.highlight;
    $('#progFormTitle').textContent = 'Programmpunkt bearbeiten';
    $('#progCancel').hidden = false;
    pForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#progSort').addEventListener('click', () => call('/api/admin/program/sort', { method: 'POST' }).then(() => { toast('Nach Uhrzeit sortiert'); load(); }));
  $('#portalQr').addEventListener('change', (e) => call('/api/admin/settings', { method: 'PUT', json: { portalQr: e.target.checked } }).then(load, load));

  function renderProgram() {
    if (!pForm.elements.date.value) resetProgForm();
    $('#portalQr').checked = !!data.settings.portalQr;
    const url = data.portal.url;
    $('#portalUrl').replaceChildren(el('div', { class: 'url' }, el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code', class: 'url-qr' }),
      el('div', {}, el('b', { text: 'Adresse der Besucher-App' }), el('a', { href: url, target: '_blank', rel: 'noopener', text: url }))));
    const now = Date.now();
    const list = data.portal.program;
    const next = list.filter((p) => p.start > now).sort((a, b) => a.start - b.start)[0];
    $('#progList').replaceChildren(...(list.length ? list.map((p, i) => {
      const status = now >= p.end ? 'past' : now >= p.start ? 'live' : p === next ? 'next' : 'future';
      return el('li', { class: `aprog ${status}${p.highlight ? ' highlight' : ''}` },
        el('div', { class: 'aprog-move' },
          el('button', { class: 'btn small ghost', text: '▲', title: 'Nach oben', disabled: i === 0, onclick: () => call(`/api/admin/program/${p.id}/move`, { method: 'POST', json: { dir: -1 } }).then(load) }),
          el('button', { class: 'btn small ghost', text: '▼', title: 'Nach unten', disabled: i === list.length - 1, onclick: () => call(`/api/admin/program/${p.id}/move`, { method: 'POST', json: { dir: 1 } }).then(load) })),
        el('div', { class: 'aprog-time' }, el('b', { text: `${hm(p.start)}–${hm(p.end)}` }), el('small', { class: 'muted', text: dayLabel(p.start) })),
        el('div', { class: 'aprog-body' },
          el('div', { class: 'row wrap' },
            el('b', { text: p.title }),
            p.highlight && el('span', { class: 'tag-star', text: '★ Highlight' }),
            el('span', { class: 'status ' + ({ live: 'running', next: 'done' }[status] || ''), text: { live: 'Läuft gerade', next: 'Als Nächstes', past: 'Vorbei', future: 'Geplant' }[status] })),
          p.description && el('p', { class: 'muted small', text: p.description })),
        el('div', { class: 'row' },
          el('button', { class: 'btn small', text: 'Bearbeiten', onclick: () => editProg(p) }),
          el('button', { class: 'btn small danger', text: 'Löschen', onclick: () => confirm(`„${p.title}“ löschen?`) && call(`/api/admin/program/${p.id}`, { method: 'DELETE' }).then(load) })));
    }) : [el('li', { class: 'muted', text: 'Noch keine Programmpunkte. Lege oben den ersten an.' })]));
  }
  setInterval(() => { if (data) renderProgram(); }, 30_000); // Status „läuft gerade“ aktuell halten

  /* ======================= Challenges ======================= */
  const qForm = $('#qrForm');
  const sForm = $('#stationForm');
  let editingQr = null;
  let editingStation = null;
  const resetQr = () => { editingQr = null; qForm.reset(); $('#qrFormTitle').textContent = 'Neue QR-Code-Challenge'; $('#qrCancel').hidden = true; };
  const resetStation = () => { editingStation = null; sForm.reset(); $('#stationFormTitle').textContent = 'Neue Station'; $('#stationCancel').hidden = true; };
  $('#qrCancel').addEventListener('click', resetQr);
  $('#stationCancel').addEventListener('click', resetStation);
  qForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = qForm.elements;
    const old = editingQr && data.portal.qr.find((q) => q.id === editingQr);
    const json = { title: f.title.value, hint: f.hint.value, points: Number(f.points.value), active: old ? old.active : true };
    try {
      if (editingQr) await call(`/api/admin/challenges/qr/${editingQr}`, { method: 'PUT', json });
      else await call('/api/admin/challenges/qr', { method: 'POST', json });
      toast('Challenge gespeichert');
      resetQr();
      load();
    } catch { /* Meldung kommt aus call() */ }
  });
  sForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = sForm.elements;
    const json = { name: f.name.value, description: f.description.value };
    try {
      if (editingStation) await call(`/api/admin/stations/${editingStation}`, { method: 'PUT', json });
      else await call('/api/admin/stations', { method: 'POST', json });
      toast('Station gespeichert');
      resetStation();
      load();
    } catch { /* Meldung kommt aus call() */ }
  });
  $('#pointsSave').addEventListener('click', () => call('/api/admin/settings', {
    method: 'PUT', json: { stationPoints: Number($('#stationPoints').value), tourBonus: Number($('#tourBonus').value) },
  }).then(() => { toast('Punkte gespeichert'); load(); }));
  $('#progressReset').addEventListener('click', () => {
    if (!confirm('Wirklich ALLE Besucherprofile, Punkte, Stempel und Coupons löschen?')) return;
    if (!confirm('Sicher? Das lässt sich nicht rückgängig machen.')) return;
    call('/api/admin/portal/reset', { method: 'POST', json: { what: 'progress' } }).then(() => { toast('Fortschritt gelöscht'); load(); });
  });

  function codeActions(kind, item) {
    return [
      el('a', { class: 'btn small', href: `/api/admin/qrcode/${kind}/${item.id}.png`, download: '', text: '⬇️ PNG' }),
      el('a', { class: 'btn small', href: `/admin/print/${kind}/${item.id}`, target: '_blank', rel: 'noopener', text: '🖨️ Drucken' }),
      el('button', {
        class: 'btn small ghost', text: 'Neuer Code', title: 'Erzeugt einen neuen QR-Code – der alte Ausdruck funktioniert dann nicht mehr',
        onclick: () => confirm('Neuen QR-Code erzeugen? Der bisherige (ausgedruckte) Code ist danach ungültig.')
          && call(`/api/admin/qrcode/${kind}/${item.id}/renew`, { method: 'POST' }).then(() => { toast('Neuer Code erzeugt – bitte neu ausdrucken'); load(); }),
      }),
    ];
  }

  function renderChallenges() {
    const st = data.portal.stats;
    const stat = (n, label) => el('div', { class: 'card stat' }, el('b', { text: n }), el('span', { text: label }));
    $('#chStats').replaceChildren(
      stat(st.visitors, 'Besucherprofile'),
      stat(st.participants, 'Haben bei Challenges mitgemacht'),
      stat(st.tours, 'Rundgänge komplett'),
      stat(`${st.pointsEarned}`, `Punkte vergeben · ${st.pointsSpent} eingetauscht`));

    if (notTyping($('#stationPoints').parentElement.parentElement)) {
      $('#stationPoints').value = data.settings.stationPoints;
      $('#tourBonus').value = data.settings.tourBonus;
    }

    $('#qrChallenges').replaceChildren(...(data.portal.qr.length ? data.portal.qr.map((q) => el('div', { class: 'code-item' + (q.active ? '' : ' off') },
      qrImg(q.url),
      el('div', { class: 'code-body' },
        el('b', { text: q.title }),
        q.hint && el('span', { class: 'muted small', text: '💡 ' + q.hint }),
        el('span', { class: 'small', text: `${q.points} Punkte · ${st.qrFinders[q.id] || 0}× gefunden` }),
        el('label', { class: 'switch' }, el('input', {
          type: 'checkbox', checked: q.active,
          onchange: (e) => call(`/api/admin/challenges/qr/${q.id}`, { method: 'PUT', json: { title: q.title, hint: q.hint, points: q.points, active: e.target.checked } }).then(load, load),
        }), el('span'), ' Aktiv'),
        el('div', { class: 'row wrap' }, ...codeActions('qr', q),
          el('button', { class: 'btn small', text: 'Bearbeiten', onclick: () => {
            editingQr = q.id;
            qForm.elements.title.value = q.title; qForm.elements.hint.value = q.hint || ''; qForm.elements.points.value = q.points;
            $('#qrFormTitle').textContent = 'Challenge bearbeiten'; $('#qrCancel').hidden = false;
          } }),
          el('button', { class: 'btn small danger', text: 'Löschen', onclick: () => confirm(`„${q.title}“ löschen? Schon vergebene Punkte bleiben erhalten.`) && call(`/api/admin/challenges/qr/${q.id}`, { method: 'DELETE' }).then(load) })))))
      : [el('p', { class: 'muted small', text: 'Noch keine QR-Code-Challenge.' })]));

    const stations = data.portal.stations;
    $('#stationList').replaceChildren(...(stations.length ? stations.map((s, i) => el('div', { class: 'code-item' },
      qrImg(s.url),
      el('div', { class: 'code-body' },
        el('b', { text: `${i + 1}. ${s.name}` }),
        s.description && el('span', { class: 'muted small', text: s.description }),
        el('span', { class: 'small', text: `${st.stationVisits[s.id] || 0} Besucher waren hier` }),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn small ghost', text: '▲', disabled: i === 0, onclick: () => call(`/api/admin/stations/${s.id}/move`, { method: 'POST', json: { dir: -1 } }).then(load) }),
          el('button', { class: 'btn small ghost', text: '▼', disabled: i === stations.length - 1, onclick: () => call(`/api/admin/stations/${s.id}/move`, { method: 'POST', json: { dir: 1 } }).then(load) }),
          ...codeActions('station', s),
          el('button', { class: 'btn small', text: 'Bearbeiten', onclick: () => {
            editingStation = s.id;
            sForm.elements.name.value = s.name; sForm.elements.description.value = s.description || '';
            $('#stationFormTitle').textContent = 'Station bearbeiten'; $('#stationCancel').hidden = false;
          } }),
          el('button', { class: 'btn small danger', text: 'Löschen', onclick: () => confirm(`Station „${s.name}“ löschen?`) && call(`/api/admin/stations/${s.id}`, { method: 'DELETE' }).then(load) })))))
      : [el('p', { class: 'muted small', text: 'Noch keine Stationen. Lege unten die erste an.' })]));

    hbars($('#chartStations'), stations.map((s) => {
      const n = st.stationVisits[s.id] || 0;
      return { label: s.name, value: n, color: series(), tip: `${s.name}: ${n} Besucher` };
    }), 'Noch keine Besuche.');
    const n = stations.length;
    hbars($('#chartProgress'), Array.from({ length: n }, (_, k) => k + 1).reverse().map((k) => ({
      label: k === n ? `Alle ${n} 🏆` : `${k} von ${n}`, value: st.distribution[k] || 0,
      color: rampAt(n > 1 ? (k - 1) / (n - 1) : 1), tip: `${st.distribution[k] || 0} Besucher haben ${k} von ${n} Stationen besucht`,
    })), 'Noch niemand hat eine Station besucht.');
  }

  /* ======================= Shop ======================= */
  const iForm = $('#itemForm');
  let editingItem = null;
  let couponFilter = 'all';
  let checked = null; // zuletzt geprüfter Coupon-Code
  const resetItem = () => { editingItem = null; iForm.reset(); iForm.elements.active.checked = true; $('#itemFormTitle').textContent = 'Neuer Artikel'; $('#itemCancel').hidden = true; };
  $('#itemCancel').addEventListener('click', resetItem);
  async function uploadImage(id, file) {
    await call(`/api/admin/shop/${id}/image`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  }
  iForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = iForm.elements;
    const json = { name: f.name.value, description: f.description.value, price: Number(f.price.value), stock: f.stock.value === '' ? null : Number(f.stock.value), active: f.active.checked };
    const file = f.image.files[0];
    try {
      let id = editingItem;
      if (id) await call(`/api/admin/shop/${id}`, { method: 'PUT', json });
      else id = (await call('/api/admin/shop', { method: 'POST', json })).id;
      if (file) await uploadImage(id, file);
      toast('Artikel gespeichert');
      resetItem();
      load();
    } catch { /* Meldung kommt aus call() */ }
  });

  function normCode(text) {
    const m = /\/einloesen\/([A-Za-z0-9-]+)/.exec(text || '');
    return (m ? m[1] : String(text || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  async function checkCoupon(code, quiet) {
    code = normCode(code);
    if (!code) return;
    try {
      const r = await window.api(`/api/admin/coupons/${code}`);
      checked = code;
      renderCoupon(r.coupon);
    } catch (err) {
      if (!quiet) { checked = null; $('#couponResult').replaceChildren(el('div', { class: 'coupon-check bad' }, el('b', { text: '✖ ' + err.message }))); }
    }
  }
  function renderCoupon(cp) {
    const state = cp.cancelledAt ? 'cancel' : cp.redeemedAt ? 'used' : 'open';
    $('#couponResult').replaceChildren(el('div', { class: 'coupon-check ' + state },
      el('div', { class: 'cc-head' },
        el('span', { class: 'cc-icon', text: { open: '🎟️', used: '⛔', cancel: '↩️' }[state] }),
        el('div', {}, el('b', { text: cp.itemName }), el('small', { class: 'muted', text: `${cp.code} · ${cp.price} Punkte · geholt ${fmtTime(cp.createdAt)}` }))),
      el('p', { class: 'cc-state', text: {
        open: '✔ Gültig – noch nicht eingelöst',
        used: `Bereits eingelöst am ${new Date(cp.redeemedAt).toLocaleString('de-DE')} Uhr${cp.redeemedBy ? ` (${cp.redeemedBy})` : ''} – nicht mehr gültig!`,
        cancel: 'Storniert – nicht gültig.',
      }[state] }),
      state === 'open' && el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary big', text: 'Jetzt einlösen', onclick: () => redeem(cp.code) }),
        el('button', { class: 'btn small ghost', text: 'Stornieren', onclick: () => cancel(cp.code) }))));
  }
  async function redeem(code) {
    try {
      const r = await call(`/api/admin/coupons/${normCode(code)}/redeem`, { method: 'POST' });
      renderCoupon(r.coupon);
      toast('Coupon eingelöst – Merch übergeben!');
      load();
    } catch { checkCoupon(code, true); }
  }
  async function cancel(code) {
    if (!confirm('Coupon stornieren? Die Punkte gehen an den Besucher zurück.')) return;
    try { const r = await call(`/api/admin/coupons/${normCode(code)}/cancel`, { method: 'POST' }); renderCoupon(r.coupon); load(); } catch { /* Meldung kommt aus call() */ }
  }
  $('#couponForm').addEventListener('submit', (e) => { e.preventDefault(); checkCoupon($('#couponCode').value); });
  $('#couponScan').addEventListener('click', async () => {
    const text = await window.scanQr();
    if (text) { $('#couponCode').value = normCode(text); checkCoupon(text); }
  });
  $('#couponFilter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    couponFilter = chip.dataset.filter;
    for (const c of $$('#couponFilter .chip')) c.classList.toggle('active', c === chip);
    renderShop();
  });

  function renderShop() {
    const s = data.portal.shop;
    $('#shopItemsAdmin').replaceChildren(...(s.items.length ? s.items.map((it) => {
      const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
        onchange: async () => { if (file.files[0]) { try { await uploadImage(it.id, file.files[0]); load(); } catch { /* Meldung */ } } } });
      return el('div', { class: 'item' + (it.active ? ' on' : '') },
        el('div', { class: 'item-media shop-thumb' }, it.image ? el('img', { src: it.image, alt: '' }) : el('span', { text: '🎁' })),
        el('div', { class: 'item-body' },
          el('b', { text: it.name }),
          it.description && el('span', { class: 'muted small', text: it.description }),
          el('span', { class: 'small', text: `⭐ ${it.price} Punkte · ${it.stock == null ? `${it.used} vergeben · unbegrenzt` : `${it.used} von ${it.stock} vergeben`}` }),
          el('label', { class: 'switch' }, el('input', {
            type: 'checkbox', checked: it.active,
            onchange: (e) => call(`/api/admin/shop/${it.id}`, { method: 'PUT', json: { name: it.name, description: it.description, price: it.price, stock: it.stock, active: e.target.checked } }).then(load, load),
          }), el('span'), ' Im Shop sichtbar'),
          el('div', { class: 'row wrap' },
            el('button', { class: 'btn small', text: 'Bearbeiten', onclick: () => {
              editingItem = it.id;
              const f = iForm.elements;
              f.name.value = it.name; f.description.value = it.description || ''; f.price.value = it.price;
              f.stock.value = it.stock == null ? '' : it.stock; f.active.checked = it.active;
              $('#itemFormTitle').textContent = 'Artikel bearbeiten'; $('#itemCancel').hidden = false;
              iForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } }),
            el('label', { class: 'btn small' }, 'Bild', file),
            el('button', { class: 'btn small danger', text: 'Löschen', onclick: () => confirm(`„${it.name}“ löschen? Ausgegebene Coupons bleiben gültig.`) && call(`/api/admin/shop/${it.id}`, { method: 'DELETE' }).then(load) }))));
    }) : [el('p', { class: 'muted', text: 'Noch keine Artikel. Lege oben den ersten Merch-Artikel an.' })]));

    const rows = s.coupons.filter((c) => !c.cancelledAt || couponFilter === 'all')
      .filter((c) => couponFilter === 'all' || (couponFilter === 'used' ? c.redeemedAt : !c.redeemedAt && !c.cancelledAt));
    $('#couponRows').replaceChildren(...(rows.length ? rows.map((c) => el('tr', { class: c.redeemedAt ? 'used' : c.cancelledAt ? 'cancel' : '' },
      el('td', { class: 'mono', text: c.code }),
      el('td', { text: c.itemName }),
      el('td', { text: c.price }),
      el('td', { text: fmtTime(c.createdAt) }),
      el('td', {}, el('span', { class: 'status ' + (c.redeemedAt ? '' : c.cancelledAt ? '' : 'done'), text: c.redeemedAt ? `Eingelöst ${fmtTime(c.redeemedAt)}${c.redeemedBy ? ` · ${c.redeemedBy}` : ''}` : c.cancelledAt ? 'Storniert' : 'Offen' })),
      el('td', {}, !c.redeemedAt && !c.cancelledAt && el('button', { class: 'btn small', text: 'Prüfen', onclick: () => { $('#couponCode').value = c.code; checkCoupon(c.code); $('#couponForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }))))
      : [el('tr', {}, el('td', { colSpan: 6, class: 'muted', text: 'Keine Coupons.' }))]));
    if (checked) checkCoupon(checked, true); // Status live aktualisieren
  }

  /* ======================= Feedback ======================= */
  let fbRating = 0;
  $('#fbFilter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    fbRating = Number(chip.dataset.rating);
    for (const c of $$('#fbFilter .chip')) c.classList.toggle('active', c === chip);
    renderFeedback();
  });
  for (const id of ['#fbSort', '#fbTextOnly', '#fbUnread']) $(id).addEventListener('change', () => renderFeedback());
  $('#fbReset').addEventListener('click', () => {
    if (confirm('Wirklich ALLE Feedbacks löschen? Tipp: vorher als CSV sichern.')) {
      call('/api/admin/portal/reset', { method: 'POST', json: { what: 'feedback' } }).then(() => { toast('Feedback gelöscht'); load(); });
    }
  });

  function renderFeedback() {
    const st = data.portal.stats.feedback;
    const all = data.portal.feedback;
    const unread = all.filter((f) => !f.read).length;
    $('#fbBadge').hidden = !unread;
    $('#fbBadge').textContent = unread;
    $('#fbAvg').textContent = st.avg == null ? '–' : st.avg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' / 5';
    $('#fbAvgIcon').textContent = st.avg == null ? '💬' : SMILEYS[Math.round(st.avg)];
    $('#fbCount').textContent = st.count ? `${st.count} Bewertung${st.count === 1 ? '' : 'en'} · ${unread} ungelesen` : 'Noch kein Feedback';
    hbars($('#chartRatings'), [5, 4, 3, 2, 1].map((r) => {
      const n = st.ratings[r - 1];
      const pct = st.count ? Math.round(n / st.count * 100) : 0;
      return { label: `${SMILEYS[r]} ${RATING[r]}`, value: n, color: ramp()[r - 1], tip: `${RATING[r]}: ${n} (${pct} %)` };
    }), 'Noch kein Feedback.');

    const sort = $('#fbSort').value;
    const time = (f) => f.updatedAt || f.at;
    const list = all
      .filter((f) => !fbRating || f.rating === fbRating)
      .filter((f) => !$('#fbTextOnly').checked || f.text)
      .filter((f) => !$('#fbUnread').checked || !f.read)
      .sort((a, b) => (sort === 'old' ? time(a) - time(b) : sort === 'best' ? b.rating - a.rating || time(b) - time(a)
        : sort === 'worst' ? a.rating - b.rating || time(b) - time(a) : time(b) - time(a)));
    $('#fbList').replaceChildren(...(list.length ? list.map((f) => el('div', { class: 'fb-entry' + (f.read ? '' : ' unread') },
      el('span', { class: 'fb-smiley', text: SMILEYS[f.rating], title: RATING[f.rating] }),
      el('div', { class: 'fb-body' },
        el('div', { class: 'row wrap' }, el('b', { text: RATING[f.rating] }),
          el('span', { class: 'muted small', text: fmtTime(time(f)) + (f.updatedAt ? ' (geändert)' : '') }),
          !f.read && el('span', { class: 'tag-new', text: 'Neu' })),
        el('p', { class: f.text ? '' : 'muted small', text: f.text || 'Kein Text' })),
      el('div', { class: 'fb-actions' },
        el('button', { class: 'btn small', text: f.read ? 'Als ungelesen' : 'Gelesen ✓', onclick: () => call(`/api/admin/feedback/${f.id}`, { method: 'PATCH', json: { read: !f.read } }).then(load) }),
        el('button', { class: 'btn small danger', text: 'Löschen', onclick: () => confirm('Dieses Feedback löschen?') && call(`/api/admin/feedback/${f.id}`, { method: 'DELETE' }).then(load) }))))
      : [el('p', { class: 'muted', text: all.length ? 'Kein Feedback passt zu diesem Filter.' : 'Noch kein Feedback eingegangen.' })]));
  }

  (window.adminExtensions ||= []).push((d) => {
    data = d;
    renderProgram();
    renderChallenges();
    renderShop();
    renderFeedback();
  });
})();
