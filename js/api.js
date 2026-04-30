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
  allowedVendors: ['Daikin Comfort', 'Coburns'],
  allowedStatuses: ['Sent', 'Pending'],
};

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
    const all = [];
    for (const status of CONFIG.allowedStatuses) {
      const data = await stFetch(
        `/inventory/v2/tenant/${CONFIG.tenantId}/purchase-orders?status=${status}&pageSize=50`
      );
      all.push(...(data.data || []));
    }
    return all
      .filter(po => CONFIG.allowedVendors.some(v =>
        (po.vendorName || '').toLowerCase().includes(v.toLowerCase())
      ))
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

  /** Submit a receipt for a PO. payload: { poId, items: [{id, quantity, serial?}], vendorDocNumber } */
  async submitReceipt(payload) {
    if (CONFIG.useMock) {
      await fakeDelay(700);
      // Simulate occasional flake to test error path
      if (payload.vendorDocNumber === 'FAIL') throw new Error('Simulated failure');
      return { receiptId: `MOCK-${Date.now()}`, success: true };
    }
    const body = {
      purchaseOrderId: payload.poId,
      vendorDocumentNumber: payload.vendorDocNumber,
      items: payload.items.map(i => ({
        skuId: i.id,
        quantity: i.quantity,
        serialNumber: i.serial || undefined,
      })),
    };
    return stFetch(`/inventory/v2/tenant/${CONFIG.tenantId}/receipts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

/* ============ HELPERS ============ */
function fakeDelay(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizePO(raw) {
  // Maps a raw ST response into the shape app.js expects.
  // Field names below are best-guess from the ST docs and may need tweaking
  // once we see real responses — keep here so app.js stays clean.
  return {
    id: raw.id,
    number: raw.number || `PO-${raw.id}`,
    vendorName: raw.vendorName || raw.vendor?.name || '',
    vendorId: raw.vendorId,
    status: raw.status,
    jobNumber: raw.jobNumber || raw.job?.number || '',
    jobAddress: raw.jobAddress || raw.shipTo || '',
    expectedOn: raw.expectedOn || raw.requiredOn || '',
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
