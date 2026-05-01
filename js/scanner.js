/* Barcode scanner — uses native BarcodeDetector when available (Chrome/Android).
   On iOS Safari where BarcodeDetector is unavailable, falls back to a "Capture"
   button that grabs a frame from the live video and sends it to Claude Vision
   (via the Cloudflare worker) to read the barcode. No external CDN required.
*/

const Scanner = (() => {
  const overlay    = () => document.getElementById('scanner-overlay');
  const video      = () => document.getElementById('scanner-video');
  const hint       = () => document.getElementById('scanner-hint');
  const cancelBtn  = () => document.getElementById('scanner-cancel');
  const manualBtn  = () => document.getElementById('scanner-manual');
  const captureBtn = () => document.getElementById('scanner-capture');

  let stream = null;
  let detector = null;
  let rafId = null;
  let activeResolve = null;
  let activeReject = null;

  async function start({ purpose = 'box' } = {}) {
    if (activeResolve) stop('cancelled');

    return new Promise(async (resolve, reject) => {
      activeResolve = resolve;
      activeReject  = reject;

      hint().textContent = purpose === 'serial'
        ? 'Scan or type the serial number'
        : 'Point camera at box barcode';
      overlay().classList.remove('hidden');
      captureBtn().classList.add('hidden');

      // ── Start camera stream ──────────────────────────────────────────────
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const vid = video();
        vid.srcObject = stream;
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

      // ── Try native BarcodeDetector (Chrome / Android / newer Webkit) ─────
      if ('BarcodeDetector' in window) {
        try {
          detector = new BarcodeDetector({
            formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'],
          });
          loopNative();
          // buttons wired below
        } catch (e) {
          startVisionFallback(resolve, reject);
        }
      } else {
        // iOS Safari — use Vision fallback
        startVisionFallback(resolve, reject);
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

  // ── Native detect loop (BarcodeDetector available) ──────────────────────────
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

  // ── Vision fallback (iOS Safari) ────────────────────────────────────────────
  function startVisionFallback(resolve, reject) {
    hint().textContent = 'Aim at barcode, then tap Capture';
    captureBtn().classList.remove('hidden');
    captureBtn().disabled = false;

    captureBtn().onclick = async () => {
      const vid = video();
      if (!vid || !vid.videoWidth) return;

      // Grab a frame from the live video
      const canvas = document.createElement('canvas');
      canvas.width  = vid.videoWidth;
      canvas.height = vid.videoHeight;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

      hint().textContent = 'Reading…';
      captureBtn().disabled = true;

      try {
        const result = await API.scanBarcode(base64);
        if (result && result.code) {
          captureBtn().classList.add('hidden');
          stop();
          activeResolve && activeResolve({ code: result.code, method: 'camera' });
        } else {
          hint().textContent = 'No barcode found — try again or type it';
          captureBtn().disabled = false;
        }
      } catch (err) {
        hint().textContent = 'Read error — try again or type it';
        captureBtn().disabled = false;
      }
    };
  }

  // ── Stop & clean up ─────────────────────────────────────────────────────────
  function stop(reason) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    detector = null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    captureBtn().classList.add('hidden');
    overlay().classList.add('hidden');
    if (reason === 'cancelled' && activeReject) {
      activeReject(new Error('cancelled'));
    }
    activeResolve = null;
    activeReject  = null;
  }

  return { start, stop };
})();

window.Scanner = Scanner;
