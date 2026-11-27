'use strict';
/* Interner Team-Chat: im Admin-Panel (Tab „Team-Chat“) und als eigene Seite /chat */
window.TeamChat = {
  mount(root, { isVisible = () => true, onUnread = () => {}, onAuth = () => {} } = {}) {
    const listEl = el('div', { class: 'chat-list', 'aria-live': 'polite' });
    const input = el('textarea', { rows: 1, maxlength: 2000, placeholder: 'Nachricht an das Team …' });
    const form = el('form', { class: 'chat-form' }, input, el('button', { class: 'btn primary', text: 'Senden' }));
    root.replaceChildren(listEl, form);
    let me = null; let last = 0; let loaded = false; let msgs = []; let unread = 0; let timer = null; let busy = false;
    const time = (t) => {
      const d = new Date(t); const today = new Date().toDateString() === d.toDateString();
      return (today ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    };
    const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    function render() {
      const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
      listEl.replaceChildren(...(msgs.length ? msgs.map((m) => {
        const mine = me && m.userId === me.id;
        return el('div', { class: 'chat-msg' + (mine ? ' mine' : '') },
          m.avatar ? el('img', { class: 'chat-av', src: m.avatar, alt: '' }) : el('span', { class: 'chat-av initials', text: initials(m.name) }),
          el('div', { class: 'chat-bubble' },
            el('div', { class: 'chat-meta' }, el('b', { text: mine ? 'Du' : m.name }), el('span', { text: time(m.at) }),
              (mine || (me && me.role !== 'redaktion')) && el('button', { type: 'button', class: 'chat-del', title: 'Löschen', text: '×', onclick: () => del(m) })),
            el('div', { class: 'chat-text', text: m.text })));
      }) : [el('p', { class: 'muted chat-empty', text: 'Noch keine Nachrichten. Schreib die erste!' })]));
      if (atBottom || !render.done) listEl.scrollTop = listEl.scrollHeight;
      render.done = true;
    }
    async function poll(full = false) {
      clearTimeout(timer);
      if (busy) return;
      busy = true;
      try {
        const first = full || !loaded;
        const r = await api('/api/staff/chat' + (first ? '' : '?after=' + last));
        onAuth(true);
        me = r.me;
        if (first) { msgs = r.messages; loaded = true; }
        else {
          if (r.ids) { const keep = new Set(r.ids); msgs = msgs.filter((m) => keep.has(m.id)); }
          const fresh = r.messages.filter((m) => !msgs.some((x) => x.id === m.id));
          msgs.push(...fresh);
          const others = fresh.filter((m) => m.userId !== me.id).length;
          if (others && !isVisible()) { unread += others; onUnread(unread); }
        }
        if (msgs.length) last = msgs[msgs.length - 1].at;
        render();
      } catch (e) {
        if (e.status === 401) onAuth(false);
      } finally {
        busy = false;
        timer = setTimeout(poll, document.hidden ? 10000 : isVisible() ? 2500 : 6000);
      }
    }
    async function del(m) {
      if (!confirm('Nachricht löschen?')) return;
      try { await api('/api/staff/chat/' + encodeURIComponent(m.id), { method: 'DELETE' }); msgs = msgs.filter((x) => x !== m); render(); } catch (e) { alert(e.message); }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await api('/api/staff/chat', { method: 'POST', json: { text } }); render.done = false; await poll(); } catch (err) { input.value = text; alert(err.message); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    poll(true);
    return {
      seen() { unread = 0; onUnread(0); render.done = false; render(); input.focus(); },
      poke() { poll(); },
    };
  },
};
