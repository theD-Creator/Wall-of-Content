'use strict';
/**
 * QR-Code-Scanner für Besucher-App und Admin-Panel.
 *   scanQr() -> Promise<string|null>  (Inhalt des QR-Codes, null bei Abbruch)
 * Live-Kamera (BarcodeDetector oder jsQR), wenn der Browser sie erlaubt – das geht nur über HTTPS
 * oder localhost. Sonst – und immer zusätzlich – „Foto vom QR-Code machen“: das funktioniert auch über HTTP.
 */
(() => {
  let jsQRReady = null;
  const loadJsQR = () => (jsQRReady ||= new Promise((resolve, reject) => {
    if (window.jsQR) return resolve();
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = resolve;
    s.onerror = () => { jsQRReady = null; reject(new Error('Der Scanner konnte nicht geladen werden.')); };
    document.head.append(s);
  }));

  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  function decode(source, w, h, maxSide, both) {
    if (!window.jsQR || !w || !h) return null;
    const k = Math.min(1, maxSide / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    ctx2d.drawImage(source, 0, 0, canvas.width, canvas.height);
    const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
    return code ? code.data : null;
  }

  function build() {
    const dlg = el('dialog', { class: 'p-dialog scanner' },
      el('div', { class: 'scan-view' },
        el('video', { playsInline: true, muted: true }),
        el('div', { class: 'scan-frame', 'aria-hidden': 'true' }),
        el('p', { class: 'scan-hint', text: 'Halte die Kamera auf den QR-Code' })),
      el('div', { class: 'scan-actions' },
        el('label', { class: 'btn' }, '📸 Foto vom QR-Code machen',
          el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true })),
        el('button', { class: 'btn ghost', type: 'button', text: 'Schließen' })));
    document.body.append(dlg);
    return dlg;
  }

  window.scanQr = function scanQr() {
    const dlg = build();
    const video = $('video', dlg);
    const hint = $('.scan-hint', dlg);
    const photo = $('input[type=file]', dlg);
    let stream = null;
    let running = false;
    let detector = null;
    let result = null;

    return new Promise((resolve) => {
      const finish = (text) => {
        if (text) result = text;
        running = false;
        if (stream) for (const t of stream.getTracks()) t.stop();
        if (dlg.open) dlg.close();
      };
      dlg.addEventListener('close', () => { finish(); dlg.remove(); resolve(result); });
      $('.scan-actions .ghost', dlg).addEventListener('click', () => finish());

      photo.addEventListener('change', async () => {
        const file = photo.files[0];
        photo.value = '';
        if (!file) return;
        hint.textContent = 'Foto wird ausgewertet …';
        try {
          await loadJsQR();
          let src;
          try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
            const url = URL.createObjectURL(file);
            src = new Image(); src.src = url; await src.decode(); URL.revokeObjectURL(url);
          }
          const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
          const text = decode(src, w, h, 1600, true) || decode(src, w, h, 900, true);
          if (text) finish(text);
          else hint.textContent = 'Auf dem Foto wurde kein QR-Code erkannt. Bitte näher rangehen und nochmal versuchen.';
        } catch (err) { hint.textContent = err.message; }
      });

      const loop = async () => {
        if (!running) return;
        try {
          if (video.readyState >= 2) {
            let text = null;
            if (detector) text = ((await detector.detect(video))[0] || {}).rawValue || null;
            else text = decode(video, video.videoWidth, video.videoHeight, 640, false);
            if (text) return finish(text);
          }
        } catch { /* nächster Versuch */ }
        setTimeout(loop, 200);
      };

      dlg.showModal();
      hint.textContent = 'Kamera wird gestartet …';
      (async () => {
        loadJsQR().catch(() => {});
        if ('BarcodeDetector' in window) {
          try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
        }
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          dlg.classList.add('no-live');
          hint.textContent = 'Tippe auf „Foto vom QR-Code machen“ und fotografiere den Code. Oder scanne ihn einfach mit der Kamera-App deines Handys.';
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (!dlg.open) { for (const t of stream.getTracks()) t.stop(); return; }
          video.srcObject = stream;
          await video.play();
          hint.textContent = 'Halte die Kamera auf den QR-Code';
          if (!detector) await loadJsQR().catch(() => {});
          running = true;
          loop();
        } catch {
          dlg.classList.add('no-live');
          hint.textContent = 'Kein Zugriff auf die Kamera. Erlaube die Kamera im Browser – oder mach ein Foto vom QR-Code.';
        }
      })();
    });
  };
})();
