'use strict';
/* Admin-Panel: Sicherung herunterladen/einspielen, Daten aus älteren Versionen übernehmen (nur Global Admin) */
(() => {
  const { toast } = window.adminApi;
  const panel = $('[data-panel="backup"]');
  const size = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB');
  const when = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  let loaded = false;

  /** Nach dem Einspielen startet der Server neu – warten, bis er wieder antwortet, dann neu laden. */
  function waitForRestart(r) {
    $('#backupNotice').replaceChildren(el('div', { class: 'card notice ok' }, el('b', { text: '✔ ' + r.message })));
    if (!r.restart) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok && tries > 2) { clearInterval(t); location.reload(); }
      } catch { /* startet noch */ }
      if (tries > 120) clearInterval(t);
    }, 1000);
  }

  async function load() {
    try {
      const i = await api('/api/admin/backup/info');
      loaded = true;
      const notes = [];
      if (i.justMigrated || i.migrated) {
        const m = i.migrated || {};
        notes.push(el('div', { class: 'card notice ok' },
          el('b', { text: '✔ Alte Daten wurden automatisch übernommen' }),
          el('span', { class: 'muted small', text: `aus ${m.from || i.justMigrated}${m.at ? ' am ' + when(m.at) : ''}. Das Original ist unverändert.` })));
      }
      if (i.restoredFrom) {
        notes.push(el('div', { class: 'card notice ok' }, el('b', { text: '✔ Sicherung eingespielt.' }),
          el('span', { class: 'muted small', text: 'Der vorherige Stand liegt in ' + i.restoredFrom })));
      }
      if (i.hint) {
        notes.push(el('div', { class: 'card notice warn' },
          el('b', { text: 'Im Programmordner liegen andere (neuere) Daten.' }),
          el('span', { class: 'muted small', text: i.hint + ' – z. B. aus „Paket teilen“. Übernehmen?' }),
          el('button', { class: 'btn small primary', type: 'button', text: 'Diese Daten übernehmen', onclick: () => importPath(i.hint) })));
      }
      $('#backupNotice').replaceChildren(...notes);
      $('#backupInfo').replaceChildren(el('div', { class: 'pack-stats' },
        el('span', { text: '📁 ' + i.dataDir }),
        el('span', { text: `💾 ${size(i.size)} · ${i.files} Dateien` })));
    } catch (e) {
      $('#backupInfo').replaceChildren(el('p', { class: 'muted', text: e.status === 403 ? 'Nur der Global Admin kann Sicherungen verwalten – sie enthalten alle Daten und Benutzer.' : e.message }));
      for (const n of $$('.btn, form, #findOld', panel)) n.hidden = e.status === 403;
    }
  }

  async function importPath(p) {
    if (!confirm(`Daten aus\n${p}\nübernehmen? Der aktuelle Stand wird vorher beiseitegelegt.`)) return;
    try {
      const r = await api('/api/admin/backup/import', { method: 'POST', json: { path: p } });
      waitForRestart(r);
    } catch (e) { toast(e.message, true); }
  }

  $('#importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    importPath(e.target.elements.path.value.trim());
  });

  $('#findOld').addEventListener('click', async () => {
    const box = $('#oldInstalls');
    box.replaceChildren(el('p', { class: 'muted small', text: 'Suche …' }));
    try {
      const { list } = await api('/api/admin/backup/old');
      box.replaceChildren(...(list.length ? list.map((o) => el('div', { class: 'old-install' },
        el('div', {}, el('b', { text: o.path }), el('small', { class: 'muted', text: 'zuletzt geändert ' + when(o.at) })),
        el('button', { class: 'btn small', type: 'button', text: 'Übernehmen', onclick: () => importPath(o.path) })))
        : [el('p', { class: 'muted small', text: 'Keine älteren Versionen mit Daten gefunden. Pfad einfach unten eintragen.' })]));
    } catch (e) { box.replaceChildren(el('p', { class: 'error', text: e.message })); }
  });

  $('#restoreInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm(`Sicherung „${file.name}“ einspielen? Der aktuelle Stand wird vorher beiseitegelegt.`)) return;
    const bar = $('#restoreProgress');
    bar.hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/backup/restore');
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) $('i', bar).style.width = (ev.loaded / ev.total * 100) + '%'; };
    xhr.onload = () => {
      bar.hidden = true;
      let r = {};
      try { r = JSON.parse(xhr.responseText); } catch { /* leer */ }
      if (xhr.status >= 200 && xhr.status < 300) waitForRestart(r);
      else toast(r.error || 'Einspielen fehlgeschlagen', true);
    };
    xhr.onerror = () => { bar.hidden = true; toast('Verbindung abgebrochen', true); };
    xhr.send(file);
  });

  $('#backupBtn').addEventListener('click', () => toast('Sicherung wird erstellt – der Download startet gleich.'));
  $('#tabs').addEventListener('click', (e) => { if (e.target.closest('[data-tab="backup"]')) load(); });
  (window.adminExtensions ||= []).push(() => { if (panel.classList.contains('active') && !loaded) load(); });
})();
