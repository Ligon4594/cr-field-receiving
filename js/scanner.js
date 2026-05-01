/* Barcode scanner — uses native BarcodeDetector when available (Chrome/Android),
   falls back to @undecaf/barcode-detector-polyfill (ZXing-based, works on iOS Safari).
   Polyfill is loaded lazily from CDN only when needed.
*/

const Scanner = (() => {
  const overlay = () => document.getElementById('scanner-overlay');
  const video = () => document.getElementById('scanner-video');
  const hint = () => document.getElementById('scanner-hint');
  const cancelBtn = () => document.getElementById('scanner-cancel');
  const manualBtn = () => document.getElementById('scanner-manual');

  let stream = null;
  let detector = null;
  let rafId = null;
  let activeResolve = null;
  let activeReject = null;

  async function start({ purpose = 'box' } = {}) {
    if (activeResolve) {
      stop('cancelled');
    }
    return new Promise(async (resolve, reject) => {
      activeResolve = resolve;
      activeReject = reject;
      hint().textContent = purpose === 'serial'
        ? 'Scan or type the serial number'
        : 'Point camera at box barcode';
      overlay().classList.remove('hidden');

      // ── Start camera stream ────────────────────────────────────────────────
      try {
        // Use { ideal } so Safari falls back gracefully instead of showing black
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const vid = video();
        vid.srcObject = stream;
        // Wait for metadata before play() — prevents black frame on iOS Safari
        await new Promise((res) => {
          if (vid.readyState >= 1) { res(); return; }
          vid.addEventListener('loadedmetadata', res, { once: true });
        });
        await vid.play().catch(() => {});
      } catch (err) {
        stop();
        const typed = window.prompt('Camera unavailable. Type the code:');
        if (typed && typed.trim()) resolve({ code: typed.trim(), method: 'typed' });
        else reject(new Error('cancelled'));
        return;
      }

      // ── Set up barcode detector ────────────────────────────────────────────
      const formats = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];

      if (!('BarcodeDetector' in window)) {
        // Load polyfill — exposes the same BarcodeDetector API, ZXing-based
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/@undecaf/barcode-detector-polyfill/dist/index.js';
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        }).catch(() => {});
      }

      if (!('BarcodeDetector' in window)) {
        // CDN failed — show hint and let user type
        hint().textContent = 'Scanner unavailable — type the code';
      } else {
        try {
          detector = new BarcodeDetector({ formats });
          loopNative();
        } catch (e) {
          hint().textContent = 'Scanner unavailable — type the code';
        }
      }

      cancelBtn().onclick = () => stop('cancelled');
      manualBtn().onclick = () => {
        stop();
        const typed = window.prompt('Type the code:');
        if (typed && typed.trim()) resolve({ code: typed.trim(), method: 'typed' });
        else reject(new Error('cancelled'));
      };
    });
  }

  function loopNative() {
    const tick = async () => {
      if (!detector || !video()) return;
      try {
        const barcodes = await detector.detect(video());
        if (barcodes && barcodes.length > 0) {
          const code = barcodes[0].rawValue;
          stop();
          activeResolve && activeResolve({ code, method: 'camera' });
          return;
        }
      } catch (_) { /* ignore frame errors */ }
      rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  function stop(reason) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    detector = null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    overlay().classList.add('hidden');
    if (reason === 'cancelled' && activeReject) {
      activeReject(new Error('cancelled'));
    }
    activeResolve = null;
    activeReject = null;
  }

  return { start, stop };
})();

window.Scanner = Scanner;
