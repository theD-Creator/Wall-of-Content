'use strict';
/* Admin-Panel: Show-Modus – die wichtigsten Schalter auf einen Blick, jede Änderung wirkt sofort */
(() => {
  const { call, toast, load } = window.adminApi;
  const panel = $('[data-panel="show"]');
  const timers = new Map();

  const fmt = (input) => {
    const v = Number(input.value);
    return (Number.isInteger(v) ? v : v.toFixed(1)) + (input.dataset.unit || '');
  };
  const flash = (node) => {
    const card = node.closest('.show-row') || node;
    card.classList.remove('saved-flash');
    void card.offsetWidth;
    card.classList.add('saved-flash');
  };

  async function saveSetting(input) {
    const key = input.dataset.show;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    try {
      await call('/api/admin/settings', { method: 'PUT', json: { [key]: value } });
      flash(input);
    } catch { load(); }
  }
  async function saveSpecial(input) {
    const on = input.checked;
    const which = input.dataset.showSpecial;
    try {
      if (which === 'hunt') await call('/api/admin/hunt', { method: 'PUT', json: { active: on } });
      if (which === 'quiz') await call('/api/admin/quiz', { method: 'PUT', json: { active: on } });
      if (which === 'board') await call('/api/admin/quiz', { method: 'PUT', json: { showBoard: on } });
      flash(input);
    } catch { /* Meldung kommt aus call() */ }
    load();
  }

  panel.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.dataset.show) return;
    if (input.type === 'range') {
      input.nextElementSibling.textContent = fmt(input);
      clearTimeout(timers.get(input));
      timers.set(input, setTimeout(() => saveSetting(input), 250)); // beim Ziehen nicht jeden Schritt senden
    }
    if (input.type === 'color') {
      clearTimeout(timers.get(input));
      timers.set(input, setTimeout(() => saveSetting(input), 300));
    }
  });
  panel.addEventListener('change', (e) => {
    const input = e.target;
    if (input.dataset.showSpecial) return saveSpecial(input);
    if (!input.dataset.show || input.type === 'range' || input.type === 'color') return;
    saveSetting(input);
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-show]')) e.target.blur(); });

  for (const b of $$('[data-show-cmd]', panel)) {
    b.addEventListener('click', async () => {
      const labels = { random: 'Wird auf der Wall gezeigt', close: 'Anzeige geschlossen', dvd: 'DVD-Logo läuft', wake: 'Wall ist wach', reload: 'Neu laden gesendet' };
      try {
        await call('/api/admin/command', { method: 'POST', json: { action: b.dataset.showCmd, target: b.dataset.target } });
        toast(labels[b.dataset.showCmd] || 'Gesendet');
      } catch { /* Meldung kommt aus call() */ }
    });
  }

  function render(data) {
    for (const input of $$('[data-show]', panel)) {
      if (input === document.activeElement || timers.has(input) && input.matches(':active')) continue; // nicht beim Bedienen überschreiben
      const v = data.settings[input.dataset.show];
      if (v === undefined) continue;
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v;
      if (input.type === 'range') input.nextElementSibling.textContent = fmt(input);
    }
    const special = { hunt: data.hunt.active, quiz: data.quiz.active, board: data.quiz.showBoard };
    for (const input of $$('[data-show-special]', panel)) input.checked = !!special[input.dataset.showSpecial];
  }
  (window.adminExtensions ||= []).push(render);
})();
