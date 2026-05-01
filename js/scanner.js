/* Barcode scanner — wraps native BarcodeDetector when available,
   falls back to ZXing-js for Safari. ZXing is loaded lazily from a CDN
   only if needed, so the rest of the app stays fast.
*/

const Scanner = (() => {
  const overlay = () => document.getElementById('scanner-overlay');
  const video = () => document.getElementById('scanner-video');
  const hint = () => document.getElementById('scanner-hint');
  const cancelBtn = () => document.getElementById('scanner-cancel');
  const manualBtn = () => document.getElementById('scanner-manual');

  let stream = null;
  let detector = null;
  let zxingReader = null;
  let rafId = null;
  let activeResolve = null;
  let activeReject = null;

  async function start({ purpose = 'box' } = {}) {
    if (activeResolve) {
      // Reject any in-flight scan first
      stop('cancelled');
    }
    return new Promise(async (resolve, reject) => {
      activeResolve = resolve;
      activeReject = reject;
      hint().textContent = purpose === 'serial'
        ? 'Scan or type the serial number'
        : 'Point camera at box barcode';
      overlay().classList.remove('hidden');

      try {
        // Use { ideal } so Safari gracefully falls back instead of showing black
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const vid = video();
        vid.srcObject = stream;
        // Wait for metadata before calling play() — prevents black frame on iOS Safari
        await new Promise((res) => {
          if (vid.readyState >= 1) { res(); return; }
          vid.addEventListener('loadedmetadata', res, { once: true });
        });
        await vid.play().catch(() => {});
      } catch (err) {
        // Camera blocked or unavailable — fall back to manual entry
        stop();
        const typed = window.prompt('Camera unavailable. Type the code:');
        if (typed && typed.trim()) resolve({ code: typed.trim(), method: 'typed' });
        else reject(new Error('cancelled'));
        return;
      }

      if ('BarcodeDetector' in window) {
        try {
          detector = new BarcodeDetector({
            formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix']
          });
          loopNative();
        } catch (e) {
          await loadZxingFallback();
        }
      } else {
        await loadZxingFallback();
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

  async function loadZxingFallback() {
    if (!window.ZXing) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/@zxing/browser@0.1.4/umd/zxing-browser.min.js';
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      }).catch(() => {});
    }
    if (!window.ZXing) {
      hint().textContent = 'Scanner unavailable — type the code';
      return;
    }
    zxingReader = new ZXing.BrowserMultiFormatReader();
    zxingReader.decodeFromVideoElement(video(), (result) => {
      if (result) {
        const code = result.getText();
        stop();
        activeResolve && activeResolve({ code, method: 'camera' });
      }
    }).catch(() => {});
  }

  function stop(reason) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (zxingReader) {
      try { zxingReader.reset(); } catch (_) {}
      zxingReader = null;
    }
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
