/* WakeScan — camera code scanner.
   Prefers the native BarcodeDetector (Android Chrome: QR + retail
   barcodes). Falls back to the bundled jsQR decoder (QR codes only)
   everywhere else. Camera access requires HTTPS or localhost. */
(function () {
  'use strict';

  const overlay = document.getElementById('scanner');
  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  const titleEl = document.getElementById('scanTitle');
  const hintEl = document.getElementById('scanHint');
  const feedbackEl = document.getElementById('scanFeedback');
  const btnClose = document.getElementById('btnScanClose');
  const btnTorch = document.getElementById('btnTorch');
  const errBox = document.getElementById('scanError');
  const errTitle = document.getElementById('scanErrorTitle');
  const errText = document.getElementById('scanErrorText');
  const btnErrClose = document.getElementById('btnScanErrClose');

  let stream = null;
  let detector = null;
  let loopId = null;
  let active = false;
  let cooldownUntil = 0;
  let lastValue = '';
  let opts = null;
  let torchOn = false;

  async function makeDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const want = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix']
        .filter((f) => supported.includes(f));
      if (!want.length) return null;
      return new window.BarcodeDetector({ formats: want });
    } catch (e) {
      return null;
    }
  }

  function showError(title, text) {
    errTitle.textContent = title;
    errText.textContent = text;
    errBox.hidden = false;
  }

  async function start(options) {
    opts = options || {};
    titleEl.textContent = opts.title || 'Scan an item';
    hintEl.textContent = opts.hint || 'Point your camera at the code';
    feedbackEl.textContent = '';
    feedbackEl.classList.remove('ok');
    errBox.hidden = true;
    btnTorch.hidden = true;
    torchOn = false;
    lastValue = '';
    cooldownUntil = 0;
    overlay.hidden = false;
    active = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('Camera not supported',
        window.isSecureContext
          ? 'This browser has no camera API. Try Chrome or Safari on your phone.'
          : 'The camera only works on a secure (https://) page. Open WakeScan over https and try again.');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      showError(
        denied ? 'Camera permission needed' : 'Camera unavailable',
        denied
          ? 'WakeScan needs the camera to scan your item. Allow camera access in your browser settings, then try again.'
          : 'Could not open the camera (' + (e && e.name ? e.name : 'unknown error') + '). Close other camera apps and try again.'
      );
      return;
    }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay quirks; muted+playsinline set */ }

    // Flashlight, where the camera supports it (most Android phones).
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        btnTorch.hidden = false;
        btnTorch.onclick = () => {
          torchOn = !torchOn;
          track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
          btnTorch.style.color = torchOn ? 'var(--warn)' : '';
        };
      }
    } catch (e) { /* capabilities unsupported */ }

    detector = await makeDetector();
    if (!detector && typeof window.jsQR !== 'function') {
      showError('Scanner failed to load', 'The QR decoder could not be loaded. Reload the app and try again.');
      return;
    }
    if (!detector) {
      hintEl.textContent = (opts.hint || 'Point your camera at the code') + ' (QR codes only on this browser)';
    }
    scanLoop();
  }

  function scanLoop() {
    if (!active) return;
    loopId = setTimeout(async () => {
      if (!active) return;
      if (Date.now() >= cooldownUntil && video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes.length && codes[0].rawValue) handleValue(codes[0].rawValue);
          } else if (typeof window.jsQR === 'function') {
            const w = video.videoWidth, h = video.videoHeight;
            if (w && h) {
              const scale = Math.min(1, 540 / w);
              canvas.width = Math.round(w * scale);
              canvas.height = Math.round(h * scale);
              const g = canvas.getContext('2d', { willReadFrequently: true });
              g.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = g.getImageData(0, 0, canvas.width, canvas.height);
              const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code && code.data) handleValue(code.data);
            }
          }
        } catch (e) { /* a single failed frame is fine */ }
      }
      scanLoop();
    }, 180);
  }

  function handleValue(value) {
    // Ignore rapid duplicate reads of the same code.
    if (value === lastValue && Date.now() < cooldownUntil + 1300) return;
    lastValue = value;
    cooldownUntil = Date.now() + 1300;
    if (!opts || !opts.onCode) return;
    const result = opts.onCode(value); // 'close' | feedback string | null
    if (result === 'close') {
      close();
    } else if (typeof result === 'string') {
      feedbackEl.classList.remove('ok');
      feedbackEl.textContent = result;
      if (navigator.vibrate) navigator.vibrate(80);
    }
  }

  function flashOk(msg) {
    feedbackEl.classList.add('ok');
    feedbackEl.textContent = msg;
  }

  function close() {
    active = false;
    clearTimeout(loopId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    overlay.hidden = true;
    const cb = opts && opts.onClose;
    opts = null;
    if (cb) cb();
  }

  btnClose.addEventListener('click', close);
  btnErrClose.addEventListener('click', close);

  window.WakeScanner = { start, close, flashOk, isOpen: () => !overlay.hidden };
})();
