'use strict';
/* Einlöse-Seite für das Merch-Team: /einloesen/<Code> (Ziel des Coupon-QR-Codes) */
(() => {
  const code = decodeURIComponent(location.pathname.split('/').pop() || '');
  const box = $('#box');
  const when = (ms) => new Date(ms).toLocaleString('de-DE') + ' Uhr';

  function show(cp, note) {
    const state = cp.cancelledAt ? 'cancel' : cp.redeemedAt ? 'used' : 'open';
    box.className = 'coupon-check ' + state;
    box.replaceChildren(...[
      el('div', { class: 'cc-head' },
        el('span', { class: 'cc-icon', text: { open: '🎟️', used: '⛔', cancel: '↩️' }[state] }),
        el('div', {}, el('b', { text: cp.itemName }), el('small', { class: 'muted', text: `${cp.code} · ${cp.price} Punkte` }))),
      el('p', { class: 'cc-state', text: note || {
        open: '✔ Gültig – noch nicht eingelöst',
        used: `Bereits eingelöst am ${when(cp.redeemedAt)}${cp.redeemedBy ? ` (${cp.redeemedBy})` : ''} – nicht mehr gültig!`,
        cancel: 'Storniert – nicht gültig.',
      }[state] }),
      state === 'open' && el('button', { class: 'btn primary big', text: 'Jetzt einlösen', onclick: redeem })].filter(Boolean));
  }
  function fail(msg) {
    box.className = 'coupon-check bad';
    box.replaceChildren(el('b', { text: '✖ ' + msg }));
  }
  async function redeem() {
    try {
      const r = await api(`/api/admin/coupons/${encodeURIComponent(code)}/redeem`, { method: 'POST' });
      show(r.coupon, '✔ Eingelöst! Bitte den Artikel übergeben.');
      box.classList.add('just');
    } catch (err) {
      load(err.message);
    }
  }
  async function load(note) {
    try {
      const r = await api(`/api/admin/coupons/${encodeURIComponent(code)}`);
      show(r.coupon, note && r.coupon.redeemedAt ? undefined : note);
    } catch (err) {
      if (err.status === 401) {
        box.className = 'coupon-check';
        box.replaceChildren(el('b', { text: 'Bitte zuerst anmelden' }),
          el('p', { class: 'muted small', text: 'Coupons kann nur das Team einlösen. Melde dich im Admin-Panel an – danach geht es automatisch hierher zurück.' }),
          el('a', { class: 'btn primary', href: '/admin?next=' + encodeURIComponent(location.pathname), text: 'Anmelden' }));
      } else fail(err.message);
    }
  }
  Fullscreen.install();
  load();
})();
