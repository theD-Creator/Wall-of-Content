'use strict';
/* Admin-Panel: Teilen-Dialog mit Link und QR-Code (für Bilder, Videos und Fotos) */
(() => {
  const { toast } = window.adminApi;
  const dlg = $('#shareDlg');

  function qrInto(box, text) {
    if (window.QRLite) {
      box.replaceChildren(el('img', { alt: 'QR-Code', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(QRLite.svg(text, { margin: 1, ecl: 'M' })) }));
    } else {
      box.replaceChildren(el('img', { alt: 'QR-Code', src: '/api/admin/qr.svg?text=' + encodeURIComponent(text) }));
    }
  }
  function open({ title, url, info }) {
    $('#sdTitle').textContent = title;
    qrInto($('#sdQr'), url);
    $('#sdUrl').value = url;
    $('#sdInfo').textContent = info || '';
    $('#sdOpen').href = url;
    const native = $('#sdNative');
    native.hidden = !(navigator.share && window.isSecureContext);
    native.onclick = () => navigator.share({ title, url }).catch(() => {});
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  const close = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
  $('#sdClose').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  $('#sdCopy').addEventListener('click', async () => {
    toast(await copyText($('#sdUrl').value, $('#sdUrl')) ? 'Link kopiert' : 'Bitte den Link markieren und kopieren');
  });

  window.adminShare = { open };
})();
