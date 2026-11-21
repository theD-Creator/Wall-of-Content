'use strict';
/* Admin-Panel im neuen Design: große Seitenüberschrift + Design aus den Einstellungen übernehmen */
(() => {
  const groupOf = {};
  let group = '';
  for (const n of $$('#tabs > *')) {
    if (n.classList.contains('nav-group')) group = n.textContent.trim();
    else if (n.dataset.tab) groupOf[n.dataset.tab] = group;
  }
  function syncTitle() {
    const b = $('#tabs button.active');
    if (!b) return;
    const label = [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    $('#pageTitle').textContent = label;
    $('#pageKicker').textContent = groupOf[b.dataset.tab] || '';
  }
  $('#tabs').addEventListener('click', () => setTimeout(syncTitle));
  syncTitle();
  (window.adminExtensions ||= []).push((data) => applyDesign(data.settings));
})();
