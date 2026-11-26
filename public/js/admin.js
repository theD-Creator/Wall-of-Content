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
  let loginUser = null;
  const avatar = (u, cls = 'avatar') => (u.avatar
    ? el('img', { class: cls, src: u.avatar, alt: '' })
    : el('span', { class: cls + ' initials', text: u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() }));
  async function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    if (events) { events.close(); events = null; }
    const { users } = await api('/api/admin/users');
    try { loginUser = loginUser || localStorage.getItem('adminUser'); } catch { /* egal */ }
    if (!users.some((u) => u.id === loginUser)) loginUser = (users.find((u) => u.role === 'global') || users[0]).id;
    const pick = (id) => {
      loginUser = id;
      for (const b of $$('#userPick button')) b.classList.toggle('selected', b.dataset.id === id);
      $('#loginError').textContent = '';
      $('#password').focus();
    };
    $('#userPick').replaceChildren(...users.map((u) => el('button', {
      type: 'button', role: 'option', dataset: { id: u.id }, class: u.hasPassword ? '' : 'no-pass',
      title: u.hasPassword ? '' : 'Noch kein Passwort vergeben', onclick: () => pick(u.id),
    }, avatar(u), el('span', { text: u.name }), u.role === 'global' && el('small', { text: 'Global Admin' }))));
    pick(loginUser);
  }
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', json: { userId: loginUser, password: $('#password').value } });
      try { localStorage.setItem('adminUser', loginUser); } catch { /* egal */ }
      $('#password').value = '';
      start();
    } catch (err) {
      $('#loginError').textContent = err.message;
    }
  });
  $('#forgotPw').addEventListener('click', async () => {
    const master = prompt('Master-Passwort eingeben – damit wird das Passwort des Global Admins zurückgesetzt:');
    if (!master) return;
    const next = prompt('Neues Passwort für den Global Admin (mindestens 6 Zeichen):');
    if (!next) return;
    try {
      const r = await api('/api/admin/reset-password', { method: 'POST', json: { master, next } });
      loginUser = r.user.id;
      await showLogin();
      $('#loginError').textContent = `Passwort von ${r.user.name} wurde zurückgesetzt. Jetzt mit dem neuen Passwort anmelden.`;
    } catch (err) {
      $('#loginError').textContent = err.message;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  /* ---------------- Tabs ---------------- */
  function openTab(name) {
    const btn = $(`#tabs button[data-tab="${name}"]`);
    if (!btn) return;
    for (const b of $$('#tabs button')) b.classList.toggle('active', b === btn);
    for (const p of $$('.panel')) p.classList.toggle('active', p.dataset.panel === name);
    try { localStorage.setItem('adminTab', name); } catch { /* egal */ }
  }
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) openTab(btn.dataset.tab);
  });
  try { const t = localStorage.getItem('adminTab'); if (t) openTab(t); } catch { /* egal */ }

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
      stat(data.devices.filter((d) => d.role === 'station').length, 'Stationen online'),
      stat(data.visitorsOnline, 'Besucher-App gerade offen'));

    const urlRow = (label, url, hint) => el('div', { class: 'url' },
      el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code', class: 'url-qr' }),
      el('div', {}, el('b', { text: label }), el('a', { href: url, target: '_blank', rel: 'noopener', text: url }), el('small', { class: 'muted', text: hint })));
    $('#urls').replaceChildren(
      urlRow('Wall (großer Bildschirm)', data.urls.wall, 'Im Browser öffnen, Taste F = Vollbild.'),
      urlRow('Fotostation (Handy/Tablet)', data.urls.station, 'QR-Code mit dem Stations-Handy scannen. Zertifikatswarnung einmalig bestätigen, damit die Kamera funktioniert.'),
      urlRow('Quiz (iPad)', data.urls.quiz, 'Zeigt die Wall, bis das Quiz im Tab „Quiz“ gestartet wird.'),
      urlRow('Besucher-App (Gäste-Handys)', data.urls.portal, 'Programm, Challenges, Merch-Shop und Feedback. Den QR-Code kannst du im Tab „Programm“ auch auf der Wall zeigen.'));
    const n = data.grid.cols * data.grid.rows;
    $('#gridLinks').replaceChildren(...Array.from({ length: n }, (_, i) => {
      const url = `${data.urls.wall}?pos=${i + 1}`;
      return el('a', { href: url, target: '_blank', rel: 'noopener', title: url },
        el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: '' }), el('span', { text: `Position ${i + 1}` }));
    }));
    $('#gridLinks').style.gridTemplateColumns = `repeat(${data.grid.cols}, minmax(0, 110px))`;
    $('#meChip').replaceChildren(avatar(data.me), el('span', { text: data.me.name }));
    $('#stationsEnabled').checked = data.settings.stationsEnabled;
    renderDevices();
  }

  function renderDevices() {
    const list = data.devices;
    $('#devices').replaceChildren(...(list.length
      ? list.map((d) => el('li', {}, el('span', { class: 'dot' }), el('b', { text: d.name }),
        el('span', { class: 'muted', text: ` ${{ wall: 'Wall', quiz: 'Quiz' }[d.role] || 'Fotostation'} · seit ${fmtTime(d.since)}` })))
      : [el('li', { class: 'muted', text: 'Keine Wall und keine Station verbunden.' })]));
  }

  function itemCard(item) {
    const isPhoto = item.kind === 'photo';
    const pending = isPhoto && item.shared && !item.reviewed;
    const preview = item.kind === 'video'
      ? VideoPreview.make(item)
      : el('img', { src: item.thumb || item.url, alt: '', loading: 'lazy' });
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
          (isPhoto || item.onWall) && el('button', {
            class: 'btn small', text: '📤 Teilen', title: 'QR-Code und Link zur Download-Seite',
            onclick: () => window.adminShare && window.adminShare.open({
              title: isPhoto ? 'Foto teilen' : item.kind === 'video' ? 'Video teilen' : 'Bild teilen',
              url: `${data.urls.download}/p/${item.id}`,
              info: isPhoto ? 'Download-Seite des Fotos.' : 'Download-Seite – funktioniert, solange der Inhalt auf der Wall ist.',
            }),
          }),
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
      el('div', { class: 'item-media ' + (isBg ? 'bg' : 'checker') }, /\.(mp4|webm)$/i.test(a.file)
        ? [el('video', { src: a.url, muted: true, loop: true, autoplay: true, playsInline: true }), el('span', { class: 'tag', text: 'Video' })]
        : el('img', { src: a.url, alt: a.name, loading: 'lazy' })),
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

  /* ---------------- Color Hunt ---------------- */
  const STATUS = { ready: 'Noch nicht gestartet', running: 'Läuft', done: 'Abgegeben' };
  function renderHunt() {
    const h = data.hunt;
    $('#huntActive').checked = h.active;
    const running = h.players.filter((p) => p.status === 'running').length;
    $('#huntBadge').hidden = !h.players.length;
    $('#huntBadge').textContent = running ? `${running} aktiv` : h.players.length;

    const winner = h.players.find((p) => p.id === h.winnerId);
    $('#huntWinner').replaceChildren(...(winner ? [
      el('span', { class: 'swatch', style: `background:${winner.color.hex}` }),
      el('b', { text: winner.name }),
      el('button', {
        class: 'btn small' + (h.showWinner ? '' : ' primary'), text: h.showWinner ? 'Auf der Wall ausblenden' : 'Auf der Wall zeigen',
        onclick: () => call('/api/admin/hunt', { method: 'PUT', json: { showWinner: !h.showWinner } }).then(load),
      }),
      el('button', { class: 'btn small ghost', text: 'Auswahl aufheben', onclick: () => call('/api/admin/hunt', { method: 'PUT', json: { winnerId: null } }).then(load) }),
    ] : [el('span', { class: 'muted', text: 'Noch kein Sieger gewählt. Klicke bei einem Teilnehmer auf „Als Sieger wählen“ – er wird sofort auf der Wall gezeigt.' })]));

    const url = data.urls.hunt;
    $('#huntUrl').replaceChildren(el('div', { class: 'url' },
      el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code', class: 'url-qr' }),
      el('div', {}, el('b', { text: 'Teilnahme-Link' }), el('a', { href: url, target: '_blank', rel: 'noopener', text: url }))));

    $('#players').replaceChildren(...(h.players.length ? h.players.map((p) => el('div', { class: 'player' + (p.id === h.winnerId ? ' winner-pick' : '') },
      el('div', { class: 'player-head' },
        el('span', { class: 'swatch', style: `background:${p.color.hex}` }),
        el('div', {}, el('b', { text: p.name }), el('div', { class: 'muted small', text: `${p.color.name} · ${fmtTime(p.joinedAt)}` })),
        el('span', { class: 'status ' + p.status, dataset: p.status === 'running' ? { deadline: p.deadline } : {}, text: STATUS[p.status] })),
      el('div', { class: 'player-photos' }, p.photos.map((src) => (src
        ? el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: '', loading: 'lazy' }))
        : el('span')))),
      el('div', { class: 'row' },
        el('span', { class: 'muted small', text: `${p.photos.filter(Boolean).length}/${p.photos.length} Fotos` }),
        el('span', { style: 'flex:1' }),
        p.id !== h.winnerId && el('button', {
          class: 'btn small primary', text: '🏆 Als Sieger wählen',
          onclick: () => call('/api/admin/hunt', { method: 'PUT', json: { winnerId: p.id } }).then(() => { toast(`${p.name} wird auf der Wall gezeigt`); load(); }),
        }),
        el('button', {
          class: 'btn small danger', text: 'Löschen',
          onclick: () => confirm(`Teilnahme von „${p.name}“ löschen?`) && call(`/api/admin/hunt/players/${p.id}`, { method: 'DELETE' }).then(load),
        }))))
      : [el('p', { class: 'muted', text: 'Noch keine Teilnehmer.' })]));
    updateCountdowns();
  }
  function updateCountdowns() {
    if (!data) return;
    const skew = data.hunt.now - (data.loadedAt || Date.now());
    const h = data.hunt;
    const clock = $('#huntClock');
    const left = h.endsAt ? Math.ceil((h.endsAt - Date.now() - skew) / 1000) : 0;
    if (h.endsAt && h.active && left > 0) {
      const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = String(left % 60).padStart(2, '0');
      clock.textContent = `Noch ${hh ? `${hh}:${String(mm).padStart(2, '0')}` : mm}:${ss}`;
    } else {
      clock.textContent = h.endsAt ? 'Abgelaufen – Color Hunt geschlossen' : 'Kein Countdown';
    }
    clock.classList.toggle('running', !!(h.endsAt && h.active && left > 0));
    clock.classList.toggle('urgent', h.endsAt && h.active && left > 0 && left <= 60);
    for (const b of $$('[data-extend], #huntCdStop')) b.disabled = !(h.endsAt && h.active && left > 0);
    for (const s of $$('.status[data-deadline]')) {
      const left = Math.max(0, Math.ceil((Number(s.dataset.deadline) - Date.now() - skew) / 1000));
      s.textContent = left ? `Läuft · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Zeit abgelaufen';
    }
  }
  setInterval(updateCountdowns, 1000);
  $('#huntCdStart').addEventListener('click', () => {
    const m = Number($('#huntMins').value);
    if (!(m >= 1 && m <= 600)) return toast('Bitte 1 bis 600 Minuten eingeben', true);
    call('/api/admin/hunt', { method: 'PUT', json: { countdownMinutes: m } })
      .then(() => { toast(`Countdown läuft: ${m} Minuten`); load(); });
  });
  for (const b of $$('[data-extend]')) {
    b.addEventListener('click', () => call('/api/admin/hunt', { method: 'PUT', json: { extendMinutes: Number(b.dataset.extend) } }).then(load));
  }
  $('#huntCdStop').addEventListener('click', () => {
    if (confirm('Countdown stoppen? Der Color Hunt bleibt geöffnet.')) call('/api/admin/hunt', { method: 'PUT', json: { countdown: null } }).then(load);
  });
  $('#huntActive').addEventListener('change', (e) => {
    call('/api/admin/hunt', { method: 'PUT', json: { active: e.target.checked } }).then(load, load);
  });
  $('#huntReset').addEventListener('click', () => {
    if (confirm('Neue Runde starten? Alle Teilnehmer, ihre Fotos und der Sieger werden gelöscht.')) {
      call('/api/admin/hunt/reset', { method: 'POST' }).then(() => { toast('Neue Runde gestartet'); load(); });
    }
  });

  /* ---------------- Quiz ---------------- */
  const qForm = $('#questionForm');
  let editingQuestion = null;
  function renderQuiz() {
    const q = data.quiz;
    $('#quizActive').checked = q.active;
    $('#quizBoard').checked = q.showBoard;
    const url = data.urls.quiz;
    $('#quizUrl').replaceChildren(el('div', { class: 'url' },
      el('img', { src: '/api/admin/qr.svg?text=' + encodeURIComponent(url), alt: 'QR-Code', class: 'url-qr' }),
      el('div', {}, el('b', { text: 'Adresse für das Quiz-iPad' }), el('a', { href: url, target: '_blank', rel: 'noopener', text: url }))));
    $('#quizScores').replaceChildren(...(q.scores.length ? q.scores.map((sc) => el('li', {},
      el('span', { class: 'rank', text: sc.rank }), el('b', { text: sc.name }),
      el('span', { class: 'muted small', text: `${sc.correct}/${sc.total} richtig · ${fmtTime(sc.at)}` }),
      el('span', { class: 'pts', text: sc.score }),
      el('button', {
        class: 'btn small ghost danger', text: '✕', title: 'Eintrag löschen',
        onclick: () => call(`/api/admin/quiz/scores/${sc.id}`, { method: 'DELETE' }).then(load),
      }))) : [el('li', { class: 'muted', text: 'Noch keine Ergebnisse.' })]));
    $('#questions').replaceChildren(...q.questions.map((qu, i) => el('div', { class: 'question' },
      el('b', { text: `${i + 1}. ${qu.text}` }),
      el('ul', {}, qu.answers.map((a, n) => el('li', { class: n === qu.correct ? 'right' : '', text: a }))),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', text: 'Bearbeiten', onclick: () => editQuestion(qu) }),
        el('button', {
          class: 'btn small danger', text: 'Löschen',
          onclick: () => confirm('Frage löschen?') && call(`/api/admin/quiz/questions/${qu.id}`, { method: 'DELETE' }).then(load),
        })))));
  }
  function editQuestion(qu) {
    editingQuestion = qu ? qu.id : null;
    qForm.reset();
    if (qu) {
      qForm.elements.text.value = qu.text;
      qu.answers.forEach((a, n) => { qForm.elements['a' + n].value = a; });
      qForm.elements.correct.value = String(qu.correct);
      qForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    $('#questionFormTitle').textContent = qu ? 'Frage bearbeiten' : 'Neue Frage';
    $('#questionCancel').hidden = !qu;
  }
  $('#questionCancel').addEventListener('click', () => editQuestion(null));
  qForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const all = [0, 1, 2, 3].map((n) => qForm.elements['a' + n].value.trim());
    const picked = Number(qForm.elements.correct.value);
    if (!all[picked]) return toast('Die markierte richtige Antwort ist leer', true);
    const answers = all.filter(Boolean);
    const json = { text: qForm.elements.text.value, answers, correct: answers.indexOf(all[picked]) };
    try {
      if (editingQuestion) await call(`/api/admin/quiz/questions/${editingQuestion}`, { method: 'PUT', json });
      else await call('/api/admin/quiz/questions', { method: 'POST', json });
      editQuestion(null);
      toast('Frage gespeichert');
      load();
    } catch { /* Meldung kommt aus call() */ }
  });
  $('#quizActive').addEventListener('change', (e) => call('/api/admin/quiz', { method: 'PUT', json: { active: e.target.checked } }).then(load, load));
  $('#quizBoard').addEventListener('change', (e) => call('/api/admin/quiz', { method: 'PUT', json: { showBoard: e.target.checked } }).then(load, load));
  $('#quizReset').addEventListener('click', () => {
    if (confirm('Die komplette Rangliste löschen?')) call('/api/admin/quiz/reset', { method: 'POST' }).then(load);
  });

  /* ---------------- Benutzer ---------------- */
  const ROLE_NAME = { global: 'Global Admin', admin: 'Admin', redaktion: 'Redaktion (nur Live-Kamera)' };
  function renderUsers() {
    const isGlobal = data.me.role === 'global';
    $('#userForm').hidden = !isGlobal;
    $('#users').replaceChildren(...data.users.map((u) => {
      const mine = u.id === data.me.id;
      const pw = el('input', { type: 'password', placeholder: 'Neues Passwort (mind. 6 Zeichen)', autocomplete: 'new-password', minLength: 6 });
      const file = el('input', {
        type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
        onchange: async () => {
          const f = file.files[0];
          if (!f) return;
          try {
            await call(`/api/admin/users/${u.id}/avatar`, { method: 'PUT', headers: { 'Content-Type': f.type }, body: f });
            load();
          } catch { /* Meldung kommt aus call() */ }
        },
      });
      return el('div', { class: 'player user' },
        el('div', { class: 'player-head' }, avatar(u, 'avatar big'),
          el('div', {}, el('b', { text: u.name + (mine ? ' (du)' : '') }),
            el('div', { class: 'muted small', text: ROLE_NAME[u.role] || 'Admin' })),
          el('span', { class: 'status ' + (u.hasPassword ? 'done' : 'running'), text: u.hasPassword ? 'Passwort gesetzt' : 'Kein Passwort' })),
        isGlobal && !mine && el('form', {
          class: 'row',
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await call(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { password: pw.value } });
              pw.value = '';
              pw.blur();
              toast(`Passwort für ${u.name} gespeichert`);
              load();
            } catch { /* Meldung kommt aus call() */ }
          },
        }, pw, el('button', { class: 'btn small primary', text: 'Festlegen' })),
        (isGlobal || mine) && el('div', { class: 'row' },
          el('label', { class: 'btn small' }, 'Profilbild ändern', file),
          mine && el('span', { class: 'muted small', text: 'Dein Passwort änderst du unter „Einstellungen“.' }),
          isGlobal && !mine && el('select', {
            class: 'role-select', 'aria-label': 'Rolle',
            onchange: (e) => call(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { role: e.target.value } }).then(load, load),
          }, ...Object.entries(ROLE_NAME).map(([v, t]) => el('option', { value: v, text: t, selected: u.role === v }))),
          isGlobal && !mine && el('button', {
            class: 'btn small danger', text: 'Löschen',
            onclick: () => confirm(`Benutzer „${u.name}“ löschen?`) && call(`/api/admin/users/${u.id}`, { method: 'DELETE' }).then(load),
          })));
    }));
  }
  $('#userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/admin/users', { method: 'POST', json: { name: e.target.elements.name.value, role: e.target.elements.role.value } });
      e.target.reset();
      load();
    } catch { /* Meldung kommt aus call() */ }
  });

  /* ---------------- Passwort ---------------- */
  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#pwNext').value !== $('#pwRepeat').value) return toast('Die neuen Passwörter stimmen nicht überein', true);
    try {
      await call('/api/admin/password', { method: 'POST', json: { current: $('#pwCurrent').value, next: $('#pwNext').value } });
      e.target.reset();
      toast('Passwort geändert');
    } catch { /* Meldung kommt aus call() */ }
  });

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
  async function makeThumb(file, kindHint) {
    const MAX = 560;
    const draw = (src, w, h) => {
      const k = Math.min(1, MAX / Math.max(w, h));
      const canvas = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
      return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    };
    const isUrl = typeof file === 'string';
    const url = isUrl ? file : URL.createObjectURL(file);
    const isVideo = isUrl ? kindHint === 'video' : file.type.startsWith('video/');
    let video = null;
    try {
      if (isVideo) {
        video = el('video', { muted: true, playsInline: true, preload: 'auto', src: url });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 20000);
          video.onloadedmetadata = () => { video.currentTime = Math.min(1, (Number.isFinite(video.duration) ? video.duration : 2) / 2); };
          video.onseeked = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error('video')); };
        });
        if (!video.videoWidth) return null; // Format kann der Browser nicht dekodieren
        return await draw(video, video.videoWidth, video.videoHeight);
      }
      const img = new Image();
      img.src = url;
      await img.decode();
      return await draw(img, img.naturalWidth, img.naturalHeight);
    } catch {
      return null;
    } finally {
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); } // Player sofort freigeben
      if (!isUrl) URL.revokeObjectURL(url);
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
      data.portal = await call('/api/admin/portal');
      data.loadedAt = Date.now();
      renderOverview(); renderItems(); renderAssets(); renderSettings(); renderHunt(); renderQuiz();
      for (const render of window.adminExtensions || []) render(data); // Programm, Challenges, Shop, Feedback (admin-portal.js)
      if (!($('#users').contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) renderUsers(); // nicht beim Tippen überschreiben
      ensureThumbs();
    }).catch(() => { loading = null; });
    return loading;
  }

  /**
   * Fehlende Vorschaubilder nachholen (z. B. für Dateien aus assets/media oder wenn es beim Upload nicht
   * geklappt hat). Ohne Vorschaubild muss die Wall jedes Video als eigenen Player laden – das ist langsam
   * und auf Tablets schnell zu viel.
   */
  const thumbTried = new Set();
  let thumbRunning = false;
  async function ensureThumbs() {
    if (thumbRunning || !data) return;
    thumbRunning = true;
    try {
      for (const item of data.items) {
        if (item.thumb || item.kind === 'photo' || thumbTried.has(item.id)) continue;
        thumbTried.add(item.id);
        const blob = await makeThumb(item.url, item.kind);
        if (blob) await api(`/api/admin/items/${item.id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob }).catch(() => {});
      }
    } finally { thumbRunning = false; }
  }

  // Schnittstelle für admin-portal.js, admin-share.js, admin-show.js, admin-pack.js
  window.adminApi = { call, toast, load: () => load(), fmtTime, data: () => data };

  async function start() {
    const me = await api('/api/admin/me');
    if (me.editor && !me.admin) { location.href = '/live'; return; } // Redaktion: nur Live-Kamera
    if (!me.admin) return showLogin();
    // nach dem Anmelden zurück zur Seite, von der man kam (z. B. Coupon einlösen)
    const next = new URLSearchParams(location.search).get('next') || '';
    if (/^\/einloesen\/[A-Za-z0-9-]{1,20}$/.test(next)) { location.href = next; return; }
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (!$('#fsSlot .fs-btn')) Fullscreen.install($('#fsSlot'));
    await load();
    if (events) events.close();
    events = connectEvents('admin', 'Admin', {
      items: load, settings: load, reconnect: load, hunt: load, quiz: load,
      program: load, challenges: load, shop: load, feedback: load,
      devices: (d) => { if (data) { data.devices = d.devices; renderOverview(); } },
    });
  }
  start();
})();
