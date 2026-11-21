'use strict';
/* Quiz auf dem iPad. Solange das Quiz nicht gestartet ist, wird die Wall of Content gezeigt. */
(() => {
  const params = new URLSearchParams(location.search);
  const frame = $('#wallFrame');
  const SHAPES = ['▲', '◆', '●', '■'];
  let state = { active: false };
  let screen = '';
  let session = null;
  let score = 0;
  let locked = false;
  let timer = null;
  let homeTimer = null;
  let idleTimer = null;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  function show(name) {
    screen = name;
    clearTimeout(homeTimer);
    cancelAnimationFrame(timer);
    for (const s of $$('.screen')) s.classList.toggle('active', s.dataset.screen === name);
    // Wall nur laden, solange sie wirklich zu sehen ist (spart Akku)
    if (name === 'wall') {
      if (frame.hidden) {
        const q = new URLSearchParams({ name: params.get('name') || 'Quiz-iPad' });
        if (params.get('pos')) q.set('pos', params.get('pos'));
        frame.src = '/?' + q;
        frame.hidden = false;
      }
    } else if (!frame.hidden) {
      frame.hidden = true;
      frame.removeAttribute('src');
    }
    resetIdle();
  }
  function home() {
    session = null;
    show(state.active ? 'intro' : 'wall');
    if (state.active) renderIntro();
  }

  // Bleibt jemand mitten in der Namenseingabe stehen, geht es nach einer Weile zurück
  function resetIdle() {
    clearTimeout(idleTimer);
    if (screen === 'name') idleTimer = setTimeout(home, 60_000);
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, resetIdle, { passive: true });

  function boardRows(board, highlightId) {
    return board.length
      ? board.map((b) => el('li', { class: b.id === highlightId ? 'me' : '' },
        el('span', { class: 'rank', text: b.rank }), el('b', { text: b.name }), el('span', { class: 'pts', text: b.score })))
      : [el('li', { class: 'muted', text: 'Noch niemand – sei die oder der Erste!' })];
  }
  function renderIntro() {
    $('#eventTitle').textContent = state.title || '';
    $('#introCount').textContent = state.count;
    $('#introBoard').replaceChildren(...boardRows(state.board || []));
  }

  /* ---------------- Ablauf ---------------- */
  $('#playBtn').addEventListener('click', () => {
    $('#name').value = '';
    $('#nameError').textContent = '';
    show('name');
    setTimeout(() => $('#name').focus(), 100);
  });
  for (const b of $$('[data-action="home"]')) b.addEventListener('click', home);

  $('#nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/quiz/start', { method: 'POST', json: { name: $('#name').value } });
      document.activeElement.blur();
      session = data.session;
      score = 0;
      ask(data.question);
    } catch (err) {
      $('#nameError').textContent = err.message;
    }
  });

  function ask(q) {
    locked = false;
    $('#qProgress').textContent = `Frage ${q.n} von ${q.total}`;
    $('#qScore').textContent = `${score} Punkte`;
    $('#qText').textContent = q.text;
    $('#qFeedback').textContent = '';
    $('#qFeedback').className = 'quiz-feedback';
    $('#qAnswers').replaceChildren(...q.answers.map((text, i) => el('button', {
      class: `quiz-answer a${i}`, type: 'button', onclick: () => answer(i),
    }, el('span', { class: 'shape', text: SHAPES[i] }), el('span', { text }))));
    show('question');
    const start = performance.now();
    const bar = $('#qTimer');
    const run = (now) => {
      const left = Math.max(0, 1 - (now - start) / (q.seconds * 1000));
      bar.style.width = (left * 100) + '%';
      bar.classList.toggle('low', left < 0.25);
      if (left <= 0) { answer(-1); return; }
      timer = requestAnimationFrame(run);
    };
    timer = requestAnimationFrame(run);
  }

  async function answer(i) {
    if (locked) return;
    locked = true;
    cancelAnimationFrame(timer);
    const buttons = $$('.quiz-answer');
    for (const b of buttons) b.disabled = true;
    if (buttons[i]) buttons[i].classList.add('picked');
    let data;
    try {
      data = await api('/api/quiz/answer', { method: 'POST', json: { session, answer: i } });
    } catch (err) {
      toast(err.message);
      home();
      return;
    }
    score = data.score;
    buttons.forEach((b, n) => b.classList.add(n === data.correctIndex ? 'right' : 'dim'));
    if (buttons[i] && !data.correct) buttons[i].classList.add('wrong');
    const fb = $('#qFeedback');
    fb.textContent = data.correct ? `Richtig! +${data.points} Punkte` : i < 0 ? 'Zeit abgelaufen!' : 'Leider falsch';
    fb.classList.add(data.correct ? 'good' : 'bad');
    $('#qScore').textContent = `${score} Punkte`;
    setTimeout(() => {
      if (!session) return;
      if (data.done) showResult(data.result); else ask(data.question);
    }, 2200);
  }

  function showResult(r) {
    session = null;
    $('#rName').textContent = r.name;
    $('#rScore').textContent = r.score;
    $('#rCorrect').textContent = `${r.correct} von ${r.total}`;
    $('#rRank').textContent = r.rank;
    $('#rPlayers').textContent = r.players;
    $('#resultBoard').replaceChildren(...boardRows(r.board, r.id));
    state.board = r.board;
    show('result');
    homeTimer = setTimeout(home, 30_000);
  }

  /* ---------------- Zustand ---------------- */
  const theme = () => api('/api/state').then((s) => applyTheme(s.settings, s.backgroundUrl, s.logoUrl)).catch(() => {});
  async function load() {
    try {
      state = await api('/api/quiz/state');
    } catch { return; }
    document.title = 'Quiz – ' + (state.title || '');
    if (state.active) {
      if (screen === 'wall') show('intro');
      if (screen === 'intro') renderIntro();
    } else if (screen === 'intro' || screen === 'name') {
      show('wall'); // laufende Runden dürfen zu Ende gespielt werden
    }
  }
  connectEvents('quiz', params.get('name') || 'Quiz-iPad', {
    quiz: load, reconnect: load,
    settings: () => { load(); theme(); },
    command: (c) => { if (c.action === 'reload' && !session) location.reload(); },
  });

  // Bildschirm wach halten
  let wakeLock = null;
  const keepAwake = async () => { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
  addEventListener('pointerdown', () => { if (!wakeLock || wakeLock.released) keepAwake(); }, { passive: true });

  Fullscreen.install();
  theme();
  show('wall');
  load();
})();
