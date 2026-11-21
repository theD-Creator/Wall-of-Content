'use strict';
/* Admin-Panel: Paket teilen – komplette Wall of Content als ZIP */
(() => {
  const { toast } = window.adminApi;
  const panel = $('[data-panel="pack"]');
  const btn = $('#packBtn');
  let info = null;

  const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB');

  function update() {
    const photos = $('#packPhotos').checked;
    const node = $('#packNode').checked;
    btn.href = `/api/admin/package.zip?photos=${photos ? 1 : 0}&node=${node ? 1 : 0}`;
    if (!info) return;
    const s = info.sizes;
    // Node.js schrumpft beim Packen auf gut ein Drittel, Medien bleiben gleich groß
    const total = s.app * 0.5 + s.assets + s.content + (photos ? s.photos : 0) + (node ? s.node * 0.38 : 0);
    const c = info.counts;
    $('#packInfo').replaceChildren(
      el('div', { class: 'pack-stats' },
        el('span', { text: `🖼️ ${c.items} Inhalte` }),
        el('span', { text: `📸 ${photos ? c.photos : 0} Gäste-Fotos` }),
        el('span', { text: `👥 ${c.users} Benutzer` }),
        el('span', { text: `📦 ca. ${mb(total)}` })));
    const warn = [];
    if (info.startPassword) {
      warn.push(`Für ${info.globalAdmin} gilt noch das Startpasswort aus admin-password.txt. Das kommt aus Sicherheitsgründen nicht mit ins Paket – `
        + 'merke es dir oder ändere es vorher unter „Einstellungen → Mein Passwort ändern“, sonst kann sich beim Empfänger niemand als Global Admin anmelden.');
    }
    if (c.usersWithoutPassword.length) {
      const names = c.usersWithoutPassword.join(', ');
      warn.push(`Ohne Passwort (können sich auch beim Empfänger nicht anmelden): ${names}${names.endsWith('.') ? '' : '.'}`);
    }
    if (node && !info.hasNode) warn.push('Hier ist kein mitgeliefertes Node.js vorhanden – der Empfänger braucht beim ersten Start Internet.');
    $('#packWarn').replaceChildren(...warn.map((t) => el('p', { class: 'share-warn', text: '⚠️ ' + t })));
  }

  async function loadInfo() {
    try {
      info = await api('/api/admin/package/info');
      panel.hidden = false;
    } catch (e) {
      info = null;
      $('#packInfo').replaceChildren(el('p', { class: 'muted', text: e.status === 403 ? 'Nur der Global Admin kann ein Paket erstellen – es enthält alle Daten und Benutzer.' : e.message }));
      btn.hidden = e.status === 403;
    }
    update();
  }

  for (const id of ['#packPhotos', '#packNode']) $(id).addEventListener('change', update);
  btn.addEventListener('click', () => {
    toast('Paket wird erstellt – der Download startet gleich. Bei vielen Videos kann das einen Moment dauern.');
  });
  // Infos laden, sobald der Tab geöffnet wird
  $('#tabs').addEventListener('click', (e) => { if (e.target.closest('[data-tab="pack"]')) loadInfo(); });
  // beim Neuladen der Seite mit offenem Tab einmal laden (nicht bei jedem Live-Update – die Größenberechnung ist teurer)
  (window.adminExtensions ||= []).push(() => { if (panel.classList.contains('active') && !info) loadInfo(); });
})();
