/* ServiceTitan API client.
   In V1 the Client Secret is held by a Cloudflare Worker proxy.
   This file makes calls to either:
     - the proxy (when CONFIG.useMock === false), or
     - in-memory mock data (when CONFIG.useMock === true)
*/

window.CONFIG = {
  useMock: false,
  tenantId: '4029621142',
  proxyBase: 'https://cr-st-proxy.tligon.workers.dev',
  // Vendor IDs from ServiceTitan (API returns vendorId integer, not vendorName string)
  // 1609 = Daikin Comfort; Coburns ID is discovered dynamically via loadVendors()
  allowedVendorIds: [1609],
  allowedVendorNames: ['Daikin Comfort', 'Coburns'], // used to auto-discover IDs
  allowedStatuses: ['Sent', 'Pending'],
};

/* ============ VENDOR MAP ============ */
// Maps vendorId (int) → display name. Pre-seeded with known ID; loadVendors()
// fills in the rest at startup so we never miss a vendor name.
const VENDOR_MAP = {
  1609: 'Daikin Comfort',
};

/** Fetch all vendors from ST and populate VENDOR_MAP + CONFIG.allowedVendorIds. */
async function loadVendors() {
  if (CONFIG.useMock) return; // mock data has inline vendorName, no lookup needed
  try {
    const data = await stFetch(
      `/inventory/v2/tenant/${CONFIG.tenantId}/vendors?pageSize=200`
    );
    const vendors = data.data || data.vendors || [];
    vendors.forEach(v => {
      if (v.id && v.name) VENDOR_MAP[v.id] = v.name;
    });
    // Build allowedVendorIds from any vendor whose name contains an allowed keyword
    const ids = vendors
      .filter(v => CONFIG.allowedVendorNames.some(n =>
        (v.name || '').toLowerCase().includes(n.toLowerCase())
      ))
      .map(v => v.id);
    if (ids.length) CONFIG.allowedVendorIds = ids;
  } catch (e) {
    // Non-fatal: fall back to the pre-seeded IDs already in CONFIG.allowedVendorIds
    console.warn('loadVendors failed, using pre-seeded vendor IDs:', e.message);
  }
}

/* ============ MOCK DATA ============ */
const MOCK_POS = [
  {
    id: 88001,
    number: 'PO-88001',
    vendorName: 'Daikin Comfort',
    vendorId: 1001,
    status: 'Sent',
    jobNumber: 'JOB-25-1142',
    jobAddress: '4502 Old Jacksonville Hwy, Tyler TX',
    expectedOn: '2026-04-30',
    items: [
      {
        id: 1, sku: 'DZ16TC0361A', description: 'Daikin DZ16TC 3-Ton Condenser',
        quantity: 1, isEquipment: true, barcodes: ['074930000111', 'DZ16TC0361A'],
      },
      {
        id: 2, sku: 'DV36SC0361A', description: 'Daikin DV36SC Air Handler 36k',
        quantity: 1, isEquipment: true, barcodes: ['074930000128', 'DV36SC0361A'],
      },
      {
        id: 3, sku: 'CONS-LINE-3458', description: '3/8" x 5/8" Line Set 25ft',
        quantity: 2, isEquipment: false, barcodes: ['711234567001'],
      },
    ],
  },
  {
    id: 88002,
    number: 'PO-88002',
    vendorName: 'Coburns',
    vendorId: 1002,
    status: 'Sent',
    jobNumber: 'JOB-25-1156',
    jobAddress: '1207 ESE Loop 323, Tyler TX',
    expectedOn: '2026-04-30',
    items: [
      {
        id: 11, sku: 'R410A-25', description: 'R-410A Refrigerant 25 lb cylinder',
        quantity: 1, isEquipment: false, barcodes: ['810123456701'],
      },
      {
        id: 12, sku: 'COPPER-7-8', description: '7/8" Copper Tubing 20ft',
        quantity: 4, isEquipment: false, barcodes: ['810123456718'],
      },
      {
        id: 13, sku: 'TXV-3T', description: 'Thermostatic Expansion Valve 3-Ton',
        quantity: 1, isEquipment: false, barcodes: ['810123456725'],
      },
      {
        id: 14, sku: 'PAD-36', description: '36" Composite Equipment Pad',
        quantity: 1, isEquipment: false, barcodes: ['810123456732'],
      },
    ],
  },
  {
    id: 88003,
    number: 'PO-88003',
    vendorName: 'Daikin Comfort',
    vendorId: 1001,
    status: 'Pending',
    jobNumber: 'JOB-25-1163',
    jobAddress: '7755 Hollytree Dr, Tyler TX',
    expectedOn: '2026-05-01',
    items: [
      {
        id: 21, sku: 'DM96VC1005', description: 'Daikin DM96VC 100k BTU 96% Furnace',
        quantity: 1, isEquipment: true, barcodes: ['074930009912'],
      },
      {
        id: 22, sku: 'CAUF3137', description: 'Daikin CAUF Cased Coil 3-Ton',
        quantity: 1, isEquipment: true, barcodes: ['074930010014'],
      },
    ],
  },
  {
    id: 88004,
    number: 'PO-88004',
    vendorName: 'Coburns',
    vendorId: 1002,
    status: 'Sent',
    jobNumber: 'JOB-25-1170',
    jobAddress: '301 Rice Rd, Tyler TX',
    expectedOn: '2026-05-02',
    items: [
      {
        id: 31, sku: 'WHIP-50-4', description: 'AC Whip 50A 4ft',
        quantity: 1, isEquipment: false, barcodes: ['810444000051'],
      },
      {
        id: 32, sku: 'DISC-60', description: '60A AC Disconnect',
        quantity: 1, isEquipment: false, barcodes: ['810444000068'],
      },
      {
        id: 33, sku: 'NITRO-80', description: 'Nitrogen 80cf Tank',
        quantity: 1, isEquipment: false, barcodes: ['810444000075'],
      },
    ],
  },
];

/* ============ TOKEN HANDLING ============ */
let _tokenCache = null;
async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 30000) {
    return _tokenCache.token;
  }
  const res = await fetch(`${CONFIG.proxyBase}/token`, { method: 'POST' });
  if (!res.ok) throw new Error(`Token error: ${res.status}`);
  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  return _tokenCache.token;
}

async function stFetch(path, options = {}) {
  const token = await getAccessToken();
  const url = `${CONFIG.proxyBase}/api${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'ST-App-Key': CONFIG.clientId || '',
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ST API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/* ============ PUBLIC API ============ */
const API = {
  /** List open POs filtered to allowed vendors + statuses. */
  async listOpenPOs() {
    if (CONFIG.useMock) {
      await fakeDelay(220);
      return MOCK_POS.filter(po =>
        CONFIG.allowedVendors.includes(po.vendorName) &&
        CONFIG.allowedStatuses.includes(po.status)
      );
    }
    // Live: pull each allowed status separately, merge, then filter vendors client-side
    // since /purchase-orders accepts a single status param.
    // Note: ST list endpoint returns vendorId (int) NOT vendorName — filter by ID.
    const all = [];
    for (const status of CONFIG.allowedStatuses) {
      const data = await stFetch(
        `/inventory/v2/tenant/${CONFIG.tenantId}/purchase-orders?status=${status}&pageSize=200`
      );
      all.push(...(data.data || []));
    }
    return all
      .filter(po => CONFIG.allowedVendorIds.includes(po.vendorId))
      .map(normalizePO);
  },

  async getPO(id) {
    if (CONFIG.useMock) {
      await fakeDelay(150);
      const po = MOCK_POS.find(p => p.id === id);
      if (!po) throw new Error('PO not found');
      return po;
    }
    const data = await stFetch(`/inventory/v2/tenant/${CONFIG.tenantId}/purchase-orders/${id}`);
    return normalizePO(data);
  },

  /** Submit a receipt for a PO.
   *  payload: { poId, items: [{id, quantity, serial?}], vendorDocNumber,
   *             unlistedItems?: [{skuId, quantity, serial?}] }
   */
  async submitReceipt(payload) {
    if (CONFIG.useMock) {
      await fakeDelay(700);
      if (payload.vendorDocNumber === 'FAIL') throw new Error('Simulated failure');
      return { receiptId: `MOCK-${Date.now()}`, success: true };
    }
    const poItems = payload.items.map(i => ({
      skuId: i.id,
      quantity: i.quantity,
      serialNumber: i.serial || undefined,
    }));
    const extraItems = (payload.unlistedItems || [])
      .filter(i => i.skuId) // only include items with a valid ST skuId
      .map(i => ({
        skuId: i.skuId,
        quantity: i.quantity,
        serialNumber: i.serial || undefined,
      }));
    const body = {
      purchaseOrderId: payload.poId,
      vendorDocumentNumber: payload.vendorDocNumber,
      items: [...poItems, ...extraItems],
    };
    return stFetch(`/inventory/v2/tenant/${CONFIG.tenantId}/receipts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Scan a vendor invoice image and extract line items + pricing via Claude Vision.
   *  imageBase64: base64-encoded JPEG string (strip the data:... prefix first).
   */
  async scanInvoice(imageBase64, mediaType = 'image/jpeg') {
    if (CONFIG.useMock) {
      await fakeDelay(1400);
      return {
        invoiceNumber: 'HQ88066',
        invoiceDate: '2026-04-28',
        vendorName: 'Daikin Comfort',
        lineItems: [
          { sku: 'DZ16TC0361A', description: 'Daikin DZ16TC 3-Ton Condenser', quantity: 1, unitPrice: 1842.50, totalPrice: 1842.50 },
          { sku: 'DV36SC0361A', description: 'Daikin DV36SC Air Handler 36k', quantity: 1, unitPrice: 987.00, totalPrice: 987.00 },
          { sku: 'CONS-LINE-3458', description: '3/8" x 5/8" Line Set 25ft', quantity: 2, unitPrice: 48.75, totalPrice: 97.50 },
        ],
        subtotal: 2927.00,
        tax: 0,
        total: 2927.00,
      };
    }
    const res = await fetch(`${CONFIG.proxyBase}/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mediaType }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Invoice scan failed: ${res.status} ${t.slice(0, 120)}`);
    }
    return res.json();
  },

  /** Send a camera frame to Claude Vision to read a barcode.
   *  Returns { code: string } or { code: null } if nothing found.
   */
  async scanBarcode(imageBase64) {
    if (CONFIG.useMock) {
      await fakeDelay(800);
      return { code: 'MOCK-CODE-12345' };
    }
    const res = await fetch(`${CONFIG.proxyBase}/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg', mode: 'barcode' }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Barcode scan failed: ${res.status} ${t.slice(0, 120)}`);
    }
    return res.json();
  },

  /** Look up a part in the ST pricebook by barcode / SKU code.
   *  Returns { skuId, sku, description, isEquipment } or null if not found.
   */
  async lookupSKU(query) {
    if (CONFIG.useMock) {
      await fakeDelay(400);
      return null; // nothing in mock pricebook
    }
    try {
      // Try materials first, then equipment
      for (const type of ['materials', 'equipment']) {
        const data = await stFetch(
          `/pricebook/v2/tenant/${CONFIG.tenantId}/${type}?search=${encodeURIComponent(query)}&pageSize=5`
        );
        const items = data.data || [];
        if (items.length > 0) {
          const it = items[0];
          return {
            skuId: it.id,
            sku: it.code || it.sku || '',
            description: it.displayName || it.name || it.description || '',
            isEquipment: type === 'equipment' || !!(it.serialized),
          };
        }
      }
    } catch { /* fall through */ }
    return null;
  },
};

/* ============ HELPERS ============ */
function fakeDelay(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Resize a File/Blob to max 1024px and return base64 JPEG string (no data: prefix).
 * iPad photos can be 8+ MB — this keeps the Claude API payload small.
 */
window.resizeImageToBase64 = function(file, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
};

/** Flatten a ST shipTo address object into a readable string. */
function formatAddress(shipTo) {
  if (!shipTo) return '';
  if (typeof shipTo === 'string') return shipTo;
  const parts = [
    shipTo.street,
    shipTo.unit,
    shipTo.city ? shipTo.city.trim() : null,
    shipTo.state,
    shipTo.zip,
  ].filter(Boolean);
  return parts.join(', ');
}

function normalizePO(raw) {
  // Maps a raw ST response into the shape app.js expects.
  // ST list endpoint confirmed field names (from live API inspection 2026-04-30):
  //   vendorId (int, NOT vendorName), shipTo (NOT jobAddress), requiredOn (NOT expectedOn)
  return {
    id: raw.id,
    number: raw.number || `PO-${raw.id}`,
    vendorName: VENDOR_MAP[raw.vendorId] || raw.vendorName || raw.vendor?.name || `Vendor ${raw.vendorId}`,
    vendorId: raw.vendorId,
    status: raw.status,
    jobNumber: raw.jobNumber || raw.job?.number || '',
    jobAddress: formatAddress(raw.shipTo) || raw.jobAddress || '',
    expectedOn: raw.requiredOn || raw.expectedOn || '',
    items: (raw.items || []).map(it => ({
      id: it.id || it.skuId,
      sku: it.skuName || it.sku || '',
      description: it.description || it.skuName || '',
      quantity: it.quantity || 1,
      isEquipment: !!(it.serialized || it.isEquipment),
      barcodes: it.barcodes || (it.skuCode ? [it.skuCode] : []),
    })),
  };
}

window.API = API;
