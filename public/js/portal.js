'use strict';
/* Besucher-App: Live-Programm, Challenges (Schatzsuche + Rundgang), Merch-Shop, Feedback */
(() => {
  const TABS = { programm: 'Programm', challenges: 'Challenges', shop: 'Merch-Shop', feedback: 'Feedback' };
  let state = null;
  let offset = 0;              // Serverzeit - lokale Zeit
  let scrolledToNow = false;
  let openCoupon = null;
  const serverNow = () => Date.now() + offset;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const day = (ms) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const mins = (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m < 60 ? `${m} Min` : `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}`;
  };

  /* ---------------- Navigation ---------------- */
  function route() {
    const tab = (location.hash.slice(1).split(/[?&]/)[0] || 'programm');
    const name = TABS[tab] ? tab : 'programm';
    for (const s of $$('.p-tab')) s.classList.toggle('active', s.dataset.tab === name);
    for (const a of $$('[data-nav]')) a.classList.toggle('active', a.dataset.nav === name);
    $('#pTab').textContent = TABS[name];
    if (name === 'programm') { scrolledToNow = false; renderProgram(); } else scrollTo(0, 0);
  }
  addEventListener('hashchange', route);

  /* ---------------- Programm ---------------- */
  function renderProgram() {
    if (!state) return;
    const now = serverNow();
    const list = state.program;
    const box = $('#programList');
    if (!list.length) {
      $('#nowCard').replaceChildren();
      box.replaceChildren(el('li', { class: 'p-empty' }, el('b', { text: 'Das Programm wird gerade vorbereitet.' }), el('span', { class: 'muted', text: 'Schau gleich nochmal vorbei!' })));
      return;
    }
    const upcoming = list.filter((p) => p.start > now).sort((a, b) => a.start - b.start);
    const next = upcoming[0];
    const live = list.filter((p) => p.start <= now && now < p.end);
    const today = new Date(now).toDateString();
    const multiDay = new Set(list.map((p) => new Date(p.start).toDateString())).size > 1;

    // Karte oben: was läuft gerade / was kommt als Nächstes
    const nowCard = $('#nowCard');
    if (live.length || next) {
      const p = live[0] || next;
      nowCard.replaceChildren(el('a', { class: 'now-card' + (live.length ? ' live' : ''), href: '#programm-' + p.id, onclick: (e) => { e.preventDefault(); $('#prog-' + p.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
        el('small', { text: live.length ? '● Jetzt live' : 'Als Nächstes' }),
        el('b', { text: p.title }),
        el('span', { text: live.length ? `noch ${mins(p.end - now)} · bis ${hm(p.end)} Uhr` : `in ${mins(p.start - now)} · ${hm(p.start)} Uhr` })));
    } else {
      nowCard.replaceChildren(el('div', { class: 'now-card over' }, el('small', { text: 'Programm' }), el('b', { text: 'Für heute ist das Programm vorbei.' }), el('span', { text: 'Danke, dass du da warst!' })));
    }

    box.replaceChildren(...list.map((p) => {
      const status = now >= p.end ? 'past' : now >= p.start ? 'live' : 'future';
      const isNext = next && p.id === next.id;
      const badge = status === 'live' ? 'Jetzt' : isNext ? 'Gleich' : status === 'past' ? 'Vorbei' : '';
      const progress = status === 'live' ? Math.min(100, (now - p.start) / (p.end - p.start) * 100) : 0;
      return el('li', { id: 'prog-' + p.id, class: `prog ${status}${p.highlight ? ' highlight' : ''}${isNext ? ' next' : ''}` },
        el('div', { class: 'prog-time' },
          el('b', { text: hm(p.start) }), el('span', { text: hm(p.end) }),
          (multiDay || new Date(p.start).toDateString() !== today) && el('small', { text: day(p.start) })),
        el('div', { class: 'prog-body' },
          el('div', { class: 'prog-top' },
            p.highlight && el('span', { class: 'prog-star', text: '★ Highlight' }),
            badge && el('span', { class: 'prog-badge ' + status + (isNext ? ' next' : ''), text: badge })),
          el('h3', { text: p.title }),
          p.description && el('p', { text: p.description }),
          status === 'live' && el('div', { class: 'prog-bar' }, el('i', { style: `width:${progress}%` }))));
    }));
    if (!scrolledToNow && live[0]) {
      scrolledToNow = true;
      setTimeout(() => $('#prog-' + live[0].id)?.scrollIntoView({ block: 'center' }), 50);
    }
  }
  setInterval(renderProgram, 15_000); // Status anhand der Uhrzeit aktualisieren

  /* ---------------- Challenges ---------------- */
  function renderChallenges() {
    const c = state.challenges;
    $('#qrList').replaceChildren(...(c.qr.length ? c.qr.map((q) => el('div', { class: 'p-card quest' + (q.doneAt ? ' done' : '') },
      el('div', { class: 'quest-icon', text: q.doneAt ? '✅' : '🔍' }),
      el('div', {},
        el('b', { text: q.title }),
        q.hint && el('p', { class: 'muted small', text: '💡 ' + q.hint }),
        el('span', { class: 'quest-pts', text: q.doneAt ? `Geschafft · +${q.points} Punkte` : `${q.points} Punkte` }))))
      : [el('p', { class: 'muted', text: 'Gerade gibt es keine QR-Code-Challenge.' })]));

    const total = c.stations.length;
    $('#tourText').textContent = total ? `${c.visited} von ${total} Stationen besucht` : 'Noch keine Stationen';
    $('#tourPts').textContent = total ? `${c.stationPoints} Punkte pro Station · ${c.tourBonus} Bonus für alle` : '';
    $('#tourBar').style.width = total ? (c.visited / total * 100) + '%' : '0%';
    const done = total > 0 && c.visited === total;
    $('#tourDone').hidden = !done;
    if (done) {
      $('#tourDone').replaceChildren(el('div', { class: 'fb-big', text: '🏆' }),
        el('b', { text: 'Rundgang geschafft!' }),
        el('span', { text: `Du hast alle ${total} Stationen besucht${c.tourDoneAt ? ` und ${c.tourBonus} Bonuspunkte bekommen` : ''}. Stark!` }));
    }
    $('#stations').replaceChildren(...(total ? c.stations.map((s, i) => el('div', { class: 'stamp-card' + (s.doneAt ? ' done' : '') },
      el('div', { class: 'stamp' }, s.doneAt
        ? [el('span', { class: 'stamp-check', text: '✓' }), el('small', { text: 'BESUCHT' }), el('small', { text: hm(s.doneAt) })]
        : [el('span', { class: 'stamp-num', text: i + 1 }), el('small', { text: 'offen' })]),
      el('div', {}, el('b', { text: s.name }), s.description && el('p', { class: 'muted small', text: s.description }))))
      : [el('p', { class: 'muted', text: 'Die Stationen werden gerade eingerichtet.' })]));
    $('#myCode').textContent = state.visitor.code;
  }

  /* ---------------- Shop ---------------- */
  function renderShop() {
    const pts = state.visitor.points;
    $('#shopPoints').textContent = pts;
    $('#shopItems').replaceChildren(...(state.shop.items.length ? state.shop.items.map((it) => {
      const soldOut = it.left === 0;
      const missing = it.price - pts;
      return el('div', { class: 'shop-item' + (soldOut ? ' sold' : '') },
        el('div', { class: 'shop-img' }, it.image ? el('img', { src: it.image, alt: '', loading: 'lazy' }) : el('span', { text: '🎁' })),
        el('div', { class: 'shop-body' },
          el('b', { text: it.name }),
          it.description && el('p', { class: 'muted small', text: it.description }),
          el('div', { class: 'shop-meta' },
            el('span', { class: 'price', text: `⭐ ${it.price}` }),
            it.left != null && el('small', { class: 'muted', text: soldOut ? 'Ausverkauft' : `Noch ${it.left} Stück` })),
          el('button', {
            class: 'btn small' + (!soldOut && missing <= 0 ? ' primary' : ''), disabled: soldOut || missing > 0,
            text: soldOut ? 'Ausverkauft' : missing > 0 ? `Noch ${missing} ⭐ nötig` : 'Coupon holen',
            onclick: () => buy(it),
          })));
    }) : [el('p', { class: 'muted', text: 'Der Merch-Shop öffnet bald.' })]));

    $('#coupons').replaceChildren(...(state.shop.coupons.length ? state.shop.coupons.map((cp) => el('button', {
      class: 'p-card coupon' + (cp.redeemedAt ? ' used' : ''), type: 'button', onclick: () => showCoupon(cp.id),
    },
    el('span', { class: 'coupon-icon', text: cp.redeemedAt ? '✔️' : '🎟️' }),
    el('div', {}, el('b', { text: cp.itemName }), el('small', { class: 'muted', text: cp.code })),
    el('span', { class: 'chip-status ' + (cp.redeemedAt ? 'used' : 'open'), text: cp.redeemedAt ? 'Eingelöst' : 'Vorzeigen' })))
      : [el('p', { class: 'muted', text: 'Noch keine Coupons. Sammle Punkte bei den Challenges!' })]));
    if (openCoupon) showCoupon(openCoupon, true);
  }

  async function buy(it) {
    if (!confirm(`Coupon für „${it.name}“ holen?\n${it.price} Punkte werden abgezogen.`)) return;
    try {
      const before = new Set(state.shop.coupons.map((c) => c.id));
      apply(await api(`/api/v/shop/${it.id}`, { method: 'POST' }));
      const fresh = state.shop.coupons.find((c) => !before.has(c.id));
      if (fresh) showCoupon(fresh.id);
    } catch (e) { toast(e.message); load(); }
  }

  function showCoupon(id, refreshOnly) {
    const cp = state.shop.coupons.find((c) => c.id === id);
    const dlg = $('#couponDlg');
    if (!cp) { if (dlg.open) dlg.close(); openCoupon = null; return; }
    if (refreshOnly && !dlg.open) return;
    openCoupon = id;
    $('#cpName').textContent = cp.itemName;
    $('#cpCode').textContent = cp.code;
    if (!$('#cpQr').src.includes(cp.id)) $('#cpQr').src = `/api/v/coupons/${cp.id}/qr.svg`;
    $('#cpUsed').hidden = !cp.redeemedAt;
    dlg.classList.toggle('used', !!cp.redeemedAt);
    $('#cpInfo').textContent = cp.redeemedAt
      ? `Eingelöst am ${new Date(cp.redeemedAt).toLocaleString('de-DE')} Uhr – dieser Coupon ist nicht mehr gültig.`
      : 'Zeig diesen Coupon am Merch-Stand. Nach dem Einlösen ist er nicht mehr gültig.';
    if (!dlg.open) dlg.showModal();
  }
  $('#couponDlg').addEventListener('close', () => { openCoupon = null; });

  /* ---------------- Feedback ---------------- */
  const SMILEYS = ['', '😖', '🙁', '😐', '🙂', '😍'];
  let editingFeedback = false;
  function renderFeedback() {
    const fb = state.feedback;
    const showThanks = fb && !editingFeedback;
    $('#fbThanks').hidden = !showThanks;
    $('#fbForm').hidden = !!showThanks;
    if (fb) $('#fbThanksIcon').textContent = SMILEYS[fb.rating];
  }
  $('#fbEdit').addEventListener('click', () => {
    editingFeedback = true;
    const fb = state.feedback;
    for (const r of $$('input[name=rating]')) r.checked = Number(r.value) === fb.rating;
    $('#fbText').value = fb.text || '';
    renderFeedback();
  });
  $('#fbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = $('input[name=rating]:checked');
    if (!picked) return toast('Bitte wähle zuerst einen Smiley aus.');
    const btn = $('#fbForm .btn');
    btn.disabled = true;
    try {
      await api('/api/v/feedback', { method: 'POST', json: { rating: Number(picked.value), text: $('#fbText').value } });
      editingFeedback = false;
      await load();
      scrollTo(0, 0);
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  /* ---------------- QR-Scanner (public/js/qrscan.js) ---------------- */
  for (const b of $$('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
  for (const b of $$('[data-scan]')) {
    b.addEventListener('click', async () => {
      const text = await scanQr();
      if (text) handleScan(text);
    });
  }

  async function handleScan(text) {
    let url = null;
    try { url = new URL(text, location.href); } catch { /* kein Link */ }
    const m = url && /^\/c\/([A-Za-z0-9_-]{16,})$/.exec(url.pathname);
    if (!m) {
      if (url && url.pathname.startsWith('/einloesen/')) return showResult({ status: 'coupon' });
      return showResult({ status: 'invalid' });
    }
    try {
      showResult(await api('/api/v/claim', { method: 'POST', json: { token: m[1] } }));
      load();
    } catch (err) { toast(err.message); }
  }

  /* ---------------- Ergebnis-Anzeige ---------------- */
  function showResult(r) {
    const box = $('#result');
    const name = r.name || '';
    const map = {
      ok: r.kind === 'qr'
        ? ['🎉', 'QR-Code gefunden!', `Du hast „${name}“ geschafft und bekommst ${r.points} Punkte.`]
        : ['✅', 'Stempel erhalten!', `Station „${name}“ ist besucht – +${r.points} Punkte.`],
      already: ['👍', 'Hast du schon!', `„${name}“ hast du bereits ${r.kind === 'qr' ? 'geschafft' : 'besucht'}. Jede Challenge zählt nur einmal.`],
      inactive: ['⏸️', 'Gerade nicht aktiv', 'Diese Challenge ist im Moment pausiert.'],
      invalid: ['🤔', 'Unbekannter QR-Code', 'Das ist kein gültiger Code der Urban Art Night. Such weiter!'],
      coupon: ['🎟️', 'Das ist ein Coupon', 'Coupons werden am Merch-Stand eingelöst.'],
      busy: ['⏳', 'Kurz warten', 'Gerade ist viel los – bitte den Code gleich nochmal scannen.'],
    };
    const [icon, title, text] = map[r.status] || map.invalid;
    box.className = 'p-result ' + r.status + (r.kind === 'station' && r.status === 'ok' ? ' stamp-anim' : '');
    $('#resIcon').textContent = icon;
    $('#resTitle').textContent = title;
    $('#resText').textContent = text + (r.tourComplete ? ` 🏆 Rundgang komplett – ${r.bonus} Bonuspunkte!` : '');
    box.hidden = false;
  }
  $('#resOk').addEventListener('click', () => { $('#result').hidden = true; location.hash = '#challenges'; });

  /* ---------------- Besucher-Code ---------------- */
  $('#restoreForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#restoreCode').value.trim();
    if (!code) return;
    if (!confirm('Fortschritt von diesem Code übernehmen? Der aktuelle Fortschritt auf diesem Gerät wird dann nicht mehr angezeigt.')) return;
    try {
      apply(await api('/api/v/restore', { method: 'POST', json: { code } }));
      $('#restoreCode').value = '';
      toast('Übernommen! Willkommen zurück.');
    } catch (err) { toast(err.message); }
  });

  /* ---------------- Laden ---------------- */
  function apply(s) {
    state = s;
    offset = s.now - Date.now();
    $('#pEvent').textContent = s.title || '';
    $('#pPoints').textContent = s.visitor.points;
    document.title = (s.title || 'Urban Art Night') + ' – Besucher-App';
    renderProgram(); renderChallenges(); renderShop(); renderFeedback();
  }
  async function load() {
    try { apply(await api('/api/v/state')); } catch (e) { toast(e.message || 'Server nicht erreichbar'); }
  }
  // Viele Handys gleichzeitig: Neuladen leicht zeitversetzt
  let pending = null;
  const soon = () => { clearTimeout(pending); pending = setTimeout(load, 200 + Math.random() * 1200); };
  const theme = () => api('/api/state').then((s) => {
    applyTheme(s.settings, s.backgroundUrl, s.logoUrl);
    $('#huntLink').hidden = !(s.hunt && s.hunt.active);
  }).catch(() => {});
  connectEvents('visitor', null, {
    program: soon, challenges: soon, shop: soon, reconnect: () => { load(); theme(); },
    settings: () => { soon(); theme(); }, hunt: theme,
  });

  // Ergebnis eines Scans mit der Handy-Kamera (Link /c/… leitet hierher)
  const q = new URLSearchParams(location.search);
  if (q.get('found')) {
    showResult({ status: q.get('found'), kind: q.get('kind'), name: q.get('name'), points: Number(q.get('pts')) || 0, tourComplete: !!q.get('tour'), bonus: Number(q.get('tour')) || 0 });
    history.replaceState(null, '', '/app' + location.hash);
  }
  route();
  theme();
  load();
})();
