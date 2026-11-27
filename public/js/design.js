'use strict';
/* Setzt das Design („neu“ oder „klassisch“) schon im <head>, damit beim Laden nichts flackert.
   Vorrang hat ?design=neu|klassisch in der Adresse, sonst die zuletzt gesehene Einstellung. */
(() => {
  const root = document.documentElement;
  const forced = new URLSearchParams(location.search).get('design');
  let d = forced === 'neu' || forced === 'klassisch' ? forced : null;
  if (d) root.dataset.designForced = '1';
  else { try { d = localStorage.getItem('wocDesign'); } catch { d = null; } }
  root.dataset.design = d === 'klassisch' ? 'klassisch' : 'neu';
})();
