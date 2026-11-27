'use strict';
/* Admin-Panel: Tab „Team-Chat“ mit Ungelesen-Zähler */
(() => {
  const panel = $('[data-panel="chat"]');
  const badge = $('#chatBadge');
  let chat = null;
  const visible = () => panel.classList.contains('active') && !document.hidden;
  const start = () => {
    if (chat) return;
    chat = TeamChat.mount($('#teamChat'), {
      isVisible: visible,
      onUnread: (n) => { badge.hidden = !n; badge.textContent = n; },
    });
  };
  // erst starten, wenn jemand angemeldet ist
  const tryStart = () => { if (!$('#app').hidden) start(); else setTimeout(tryStart, 1500); };
  tryStart();
  $('#tabs').addEventListener('click', () => setTimeout(() => { if (chat && visible()) chat.seen(); }));
  document.addEventListener('visibilitychange', () => { if (chat && visible()) chat.seen(); });
})();
