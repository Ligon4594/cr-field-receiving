/* C&R Field Receiving — main app logic.
   Single-file controller, no framework. Views are show/hide divs in index.html.
*/

const State = {
  view: 'list',
  vendorFilter: 'all',
  pos: [],
  selectedPO: null,
  confirmations: {},      // itemId -> { confirmed, serial?, scannedCode? }
  vendorDocNumber: '',
  loading: false,
  // V2 additions
  invoiceData: null,      // parsed result from Claude vision scan
  itemPrices: {},         // itemId -> unitPrice (matched from invoice)
  unlistedItems: [],      // [{tempId, skuId, sku, description, quantity, unitPrice, serial, confirmed, notInST}]
  _unlistedSeq: 0,        // incrementing temp ID for unlisted items
};

/* ============ BOOT ============ */
document.addEventListener('DOMContentLoaded', () => {
  bindGlobalEvents();
  updateEnvBadge();
  loadPOList();
});

function bindGlobalEvents() {
  // Vendor filter chips
  document.querySelectorAll('.chip[data-vendor]').forEach(chip => {
    chip.addEventListener('click', () => {
      State.vendorFilter = chip.dataset.vendor;
      document.querySelectorAll('.chip[data-vendor]').forEach(c => c.classList.remove('chip-active'));
      chip.classList.add('chip-active');
      renderPOList();
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', loadPOList);

  // Detail navigation + actions
  document.body.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'back-to-list') showView('list');
    if (action === 'back-to-detail') showView('detail');
  });

  // Submit
  const docInput = document.getElementById('vendor-doc');
  docInput.addEventListener('input', () => {
    State.vendorDocNumber = docInput.value.trim();
    updateSubmitState();
  });
  document.getElementById('submit-btn').addEventListener('click', submitReceipt);

  // Scan-any (top-of-detail) tries to match the scan to any unconfirmed line item
  document.getElementById('scan-any-btn').addEventListener('click', scanAndMatch);

  // Retry from error view
  document.getElementById('retry-btn').addEventListener('click', submitReceipt);

  // Invoice scan card
  document.getElementById('invoice-scan-btn').addEventListener('click', () => {
    document.getElementById('invoice-file-input').click();
  });
  document.getElementById('invoice-file-input').addEventListener('change', onInvoiceFileSelected);

  // Add unlisted item
  document.getElementById('add-unlisted-btn').addEventListener('click', addUnlistedItem);
}

function updateEnvBadge() {
  const badge = document.getElementById('env-badge');
  if (CONFIG.useMock) {
    badge.textContent = 'MOCK DATA';
    badge.className = 'env-badge env-mock';
  } else {
    badge.textContent = 'LIVE';
    badge.className = 'env-badge env-live';
  }
}

/* ============ VIEW ROUTING ============ */
function showView(name) {
  State.view = name;
  ['list', 'detail', 'success', 'error'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('view-active', v === name);
  });
  window.scrollTo(0, 0);
}

/* ============ PO LIST ============ */
async function loadPOList() {
  State.loading = true;
  const listEl = document.getElementById('po-list');
  listEl.innerHTML = '<div class="empty">Loading…</div>';
  try {
    await loadVendors(); // populate VENDOR_MAP + discover Coburns vendorId
    State.pos = await API.listOpenPOs();
    renderPOList();
  } catch (err) {
    listEl.innerHTML = '';
    toast(`Could not load POs: ${err.message}`, 'err');
  } finally {
    State.loading = false;
  }
}

function renderPOList() {
  const listEl = document.getElementById('po-list');
  const emptyEl = document.getElementById('po-empty');
  const filtered = State.pos.filter(po =>
    State.vendorFilter === 'all' || po.vendorName === State.vendorFilter
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = filtered.map(po => `
    <div class="po-card" role="listitem" data-po-id="${po.id}">
      <div class="po-card-top">
        <div class="po-number">${escape(po.number)}</div>
        <span class="po-status po-status-${po.status.toLowerCase()}">${escape(po.status)}</span>
      </div>
      <div class="po-vendor">${escape(po.vendorName)}</div>
      <div class="po-meta">
        <span><strong>${escape(po.jobNumber)}</strong> &middot; ${escape(po.jobAddress)}</span>
        <span>${formatItemCount(po.items)} items &middot; ${formatDate(po.expectedOn)}</span>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.po-card').forEach(card => {
    card.addEventListener('click', () => openPO(parseInt(card.dataset.poId, 10)));
  });
}

/* ============ PO DETAIL ============ */
async function openPO(id) {
  try {
    const po = await API.getPO(id);
    State.selectedPO = po;
    State.confirmations = {};
    State.vendorDocNumber = '';
    State.invoiceData = null;
    State.itemPrices = {};
    State.unlistedItems = [];
    State._unlistedSeq = 0;
    document.getElementById('vendor-doc').value = '';
    document.getElementById('invoice-file-input').value = '';
    resetInvoiceCard();
    renderDetail();
    showView('detail');
  } catch (err) {
    toast(`Could not open PO: ${err.message}`, 'err');
  }
}

function renderDetail() {
  const po = State.selectedPO;
  if (!po) return;

  document.getElementById('detail-po-number').textContent = po.number;
  document.getElementById('detail-vendor').textContent = po.vendorName;
  document.getElementById('detail-job').textContent = `${po.jobNumber} — ${po.jobAddress}`;
  document.getElementById('detail-expected').textContent = formatDate(po.expectedOn);

  // PO line items
  const itemsEl = document.getElementById('line-items');
  itemsEl.innerHTML = po.items.map(it => renderItemRow(it)).join('');
  itemsEl.querySelectorAll('[data-action="scan-item"]').forEach(btn => {
    btn.addEventListener('click', () => scanForItem(parseInt(btn.dataset.itemId, 10)));
  });
  itemsEl.querySelectorAll('[data-action="serial-item"]').forEach(btn => {
    btn.addEventListener('click', () => captureSerial(parseInt(btn.dataset.itemId, 10)));
  });
  itemsEl.querySelectorAll('[data-action="toggle-item"]').forEach(btn => {
    btn.addEventListener('click', () => toggleItem(parseInt(btn.dataset.itemId, 10)));
  });

  // Unlisted items
  const unlistedEl = document.getElementById('unlisted-items');
  unlistedEl.innerHTML = State.unlistedItems.map(it => renderUnlistedRow(it)).join('');
  unlistedEl.querySelectorAll('[data-action="confirm-unlisted"]').forEach(btn => {
    btn.addEventListener('click', () => toggleUnlisted(btn.dataset.tempId));
  });
  unlistedEl.querySelectorAll('[data-action="remove-unlisted"]').forEach(btn => {
    btn.addEventListener('click', () => removeUnlisted(btn.dataset.tempId));
  });
  unlistedEl.querySelectorAll('[data-action="serial-unlisted"]').forEach(btn => {
    btn.addEventListener('click', () => captureUnlistedSerial(btn.dataset.tempId));
  });

  updateProgress();
  updateSubmitState();
}

function renderItemRow(item) {
  const conf = State.confirmations[item.id];
  const confirmed = conf?.confirmed;
  const serial = conf?.serial;
  const price = State.itemPrices[item.id];
  const priceLabel = price != null
    ? `<span class="item-price">Billed: ${formatCurrency(price)}</span>`
    : '';
  return `
    <div class="item-row ${confirmed ? 'confirmed' : ''}" data-item-id="${item.id}">
      <div class="item-check">${confirmed ? '&#x2713;' : ''}</div>
      <div class="item-body">
        <div class="item-name">${escape(item.description)}</div>
        <div class="item-meta">
          <span>SKU: ${escape(item.sku)}</span>
          <span>Qty: ${item.quantity}</span>
          ${item.isEquipment ? '<span class="badge">Serialized</span>' : ''}
          ${priceLabel}
        </div>
        ${serial ? `<div class="item-serial">SN: ${escape(serial)}</div>` : ''}
      </div>
      <div class="item-actions">
        ${item.isEquipment ? `
          <button class="btn-icon-only" data-action="serial-item" data-item-id="${item.id}" aria-label="Capture serial">SN</button>
        ` : ''}
        <button class="btn-icon-only" data-action="scan-item" data-item-id="${item.id}" aria-label="Scan">&#x25a3;</button>
        <button class="btn-icon-only" data-action="toggle-item" data-item-id="${item.id}" aria-label="Toggle">&#x2713;</button>
      </div>
    </div>
  `;
}

function renderUnlistedRow(item) {
  const confirmed = item.confirmed;
  const notInST = item.notInST;
  return `
    <div class="item-row unlisted-row ${confirmed ? 'confirmed' : ''}" data-temp-id="${item.tempId}">
      <div class="item-check">${confirmed ? '&#x2713;' : ''}</div>
      <div class="item-body">
        <div class="item-name">${escape(item.description)}
          ${notInST ? '<span class="badge badge-warn">Not in ST</span>' : ''}
        </div>
        <div class="item-meta">
          ${item.sku ? `<span>SKU: ${escape(item.sku)}</span>` : ''}
          <span>Qty: ${item.quantity}</span>
          ${item.unitPrice != null ? `<span class="item-price">$${formatCurrency(item.unitPrice)}</span>` : ''}
          ${item.isEquipment ? '<span class="badge">Serialized</span>' : ''}
        </div>
        ${item.serial ? `<div class="item-serial">SN: ${escape(item.serial)}</div>` : ''}
        ${notInST ? `<div class="item-not-in-st">Won't post to ST — note for records only</div>` : ''}
      </div>
      <div class="item-actions">
        ${item.isEquipment && !item.serial ? `
          <button class="btn-icon-only" data-action="serial-unlisted" data-temp-id="${item.tempId}" aria-label="Serial">SN</button>
        ` : ''}
        <button class="btn-icon-only" data-action="confirm-unlisted" data-temp-id="${item.tempId}" aria-label="Confirm">&#x2713;</button>
        <button class="btn-icon-only btn-remove" data-action="remove-unlisted" data-temp-id="${item.tempId}" aria-label="Remove">&times;</button>
      </div>
    </div>
  `;
}

function toggleItem(itemId) {
  const item = State.selectedPO.items.find(i => i.id === itemId);
  if (!item) return;
  const cur = State.confirmations[itemId] || {};
  if (cur.confirmed) {
    delete State.confirmations[itemId];
  } else {
    if (item.isEquipment && !cur.serial) {
      captureSerial(itemId);
      return;
    }
    State.confirmations[itemId] = { ...cur, confirmed: true };
  }
  renderDetail();
}

async function scanForItem(itemId) {
  const item = State.selectedPO.items.find(i => i.id === itemId);
  if (!item) return;
  try {
    const { code } = await Scanner.start({ purpose: 'box' });
    if (matchesItem(item, code)) {
      const cur = State.confirmations[itemId] || {};
      if (item.isEquipment && !cur.serial) {
        toast('Box scanned. Now capture the serial.');
        State.confirmations[itemId] = { ...cur, scannedCode: code };
        renderDetail();
        captureSerial(itemId);
      } else {
        State.confirmations[itemId] = { ...cur, scannedCode: code, confirmed: true };
        renderDetail();
      }
    } else {
      toast(`Code ${code} doesn't match this item.`, 'warn');
    }
  } catch (err) {
    if (err.message !== 'cancelled') toast(err.message, 'err');
  }
}

async function scanAndMatch() {
  try {
    const { code } = await Scanner.start({ purpose: 'box' });
    const match = State.selectedPO.items.find(it => matchesItem(it, code));
    if (!match) {
      toast(`No match found for ${code}`, 'warn');
      return;
    }
    const cur = State.confirmations[match.id] || {};
    if (match.isEquipment && !cur.serial) {
      State.confirmations[match.id] = { ...cur, scannedCode: code };
      renderDetail();
      toast(`Matched ${match.sku} — capture serial`);
      captureSerial(match.id);
    } else {
      State.confirmations[match.id] = { ...cur, scannedCode: code, confirmed: true };
      renderDetail();
      toast(`Confirmed ${match.sku}`);
    }
  } catch (err) {
    if (err.message !== 'cancelled') toast(err.message, 'err');
  }
}

async function captureSerial(itemId) {
  const item = State.selectedPO.items.find(i => i.id === itemId);
  if (!item) return;
  let serial;
  try {
    const result = await Scanner.start({ purpose: 'serial' });
    serial = result.code;
  } catch (err) {
    if (err.message === 'cancelled') {
      const typed = window.prompt(`Serial number for ${item.sku}:`);
      if (!typed) return;
      serial = typed.trim();
    } else {
      toast(err.message, 'err');
      return;
    }
  }
  const cur = State.confirmations[itemId] || {};
  State.confirmations[itemId] = { ...cur, serial, confirmed: true };
  renderDetail();
}

function matchesItem(item, code) {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  if (item.sku && item.sku.toUpperCase() === c) return true;
  return (item.barcodes || []).some(b => b.toUpperCase() === c);
}

/* ============ INVOICE SCAN ============ */

function resetInvoiceCard() {
  const card = document.getElementById('invoice-card');
  const titleEl = document.getElementById('invoice-card-title');
  const subEl = document.getElementById('invoice-card-sub');
  const iconEl = document.getElementById('invoice-card-icon');
  const scanBtn = document.getElementById('invoice-scan-btn');
  card.classList.remove('invoice-card-done');
  iconEl.textContent = '📄';
  titleEl.textContent = 'Scan Vendor Invoice';
  subEl.textContent = 'Auto-fill invoice # and billed prices';
  scanBtn.textContent = 'Scan';
}

async function onInvoiceFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Show spinner
  document.getElementById('invoice-scanning').classList.remove('hidden');
  document.getElementById('invoice-card').classList.add('hidden');

  try {
    const base64 = await resizeImageToBase64(file);
    const mediaType = file.type || 'image/jpeg';
    const result = await API.scanInvoice(base64, mediaType);
    State.invoiceData = result;

    // Auto-fill invoice number
    if (result.invoiceNumber) {
      State.vendorDocNumber = result.invoiceNumber;
      document.getElementById('vendor-doc').value = result.invoiceNumber;
    }

    // Match invoice line items to PO items and store prices
    if (result.lineItems?.length) {
      matchInvoicePrices(result.lineItems);
    }

    // Update the invoice card to show success state
    const card = document.getElementById('invoice-card');
    const titleEl = document.getElementById('invoice-card-title');
    const subEl = document.getElementById('invoice-card-sub');
    const iconEl = document.getElementById('invoice-card-icon');
    const scanBtn = document.getElementById('invoice-scan-btn');
    card.classList.add('invoice-card-done');
    iconEl.textContent = '✓';
    titleEl.textContent = result.invoiceNumber ? `Invoice #${result.invoiceNumber}` : 'Invoice Scanned';
    subEl.textContent = result.total != null
      ? `Total: ${formatCurrency(result.total, true)} · ${result.lineItems?.length || 0} line items`
      : `${result.lineItems?.length || 0} line items extracted`;
    scanBtn.textContent = 'Re-scan';

    toast('Invoice scanned — invoice # and prices applied');
    renderDetail();
    updateSubmitState();
  } catch (err) {
    toast(`Invoice scan failed: ${err.message}`, 'err');
  } finally {
    document.getElementById('invoice-scanning').classList.add('hidden');
    document.getElementById('invoice-card').classList.remove('hidden');
    // Reset file input so same file can be re-selected
    document.getElementById('invoice-file-input').value = '';
  }
}

function matchInvoicePrices(invoiceLines) {
  const po = State.selectedPO;
  if (!po) return;
  State.itemPrices = {};
  for (const poItem of po.items) {
    const match = invoiceLines.find(il => {
      if (il.sku && poItem.sku && il.sku.toUpperCase() === poItem.sku.toUpperCase()) return true;
      if (il.description && poItem.description) {
        const a = il.description.toLowerCase();
        const b = poItem.description.toLowerCase();
        return a.includes(b.slice(0, 12)) || b.includes(a.slice(0, 12));
      }
      return false;
    });
    if (match?.unitPrice != null) {
      State.itemPrices[poItem.id] = match.unitPrice;
    }
  }
}

/* ============ UNLISTED ITEMS ============ */

async function addUnlistedItem() {
  // Step 1: scan or type a barcode
  let code;
  try {
    const result = await Scanner.start({ purpose: 'box' });
    code = result.code;
  } catch (err) {
    if (err.message === 'cancelled') return;
    // Fall through to manual entry
    code = null;
  }

  if (!code) {
    code = window.prompt('Enter SKU or barcode:');
    if (!code?.trim()) return;
    code = code.trim();
  }

  toast('Looking up item…');

  // Step 2: look up in ST pricebook
  const found = await API.lookupSKU(code);

  let item;
  if (found) {
    item = {
      tempId: `u${++State._unlistedSeq}`,
      skuId: found.skuId,
      sku: found.sku,
      description: found.description,
      quantity: 1,
      unitPrice: null,
      isEquipment: found.isEquipment,
      serial: null,
      confirmed: false,
      notInST: false,
    };
    toast(`Found: ${found.description}`);
  } else {
    // Not in ST — manual entry, mark as note-only
    const desc = window.prompt(`"${code}" not found in ServiceTitan pricebook.\nEnter a description:`);
    if (!desc?.trim()) return;
    const qtyStr = window.prompt('Quantity?', '1');
    const qty = parseInt(qtyStr, 10) || 1;
    item = {
      tempId: `u${++State._unlistedSeq}`,
      skuId: null,
      sku: code,
      description: desc.trim(),
      quantity: qty,
      unitPrice: null,
      isEquipment: false,
      serial: null,
      confirmed: false,
      notInST: true,
    };
    toast('Added as note — won\'t post to ST', 'warn');
  }

  // Try to find price from scanned invoice
  if (State.invoiceData?.lineItems && item.sku) {
    const il = State.invoiceData.lineItems.find(l =>
      l.sku && l.sku.toUpperCase() === item.sku.toUpperCase()
    );
    if (il?.unitPrice != null) item.unitPrice = il.unitPrice;
  }

  State.unlistedItems.push(item);
  renderDetail();
}

function toggleUnlisted(tempId) {
  const item = State.unlistedItems.find(i => i.tempId === tempId);
  if (!item) return;
  if (item.confirmed) {
    item.confirmed = false;
  } else {
    if (item.isEquipment && !item.serial) {
      captureUnlistedSerial(tempId);
      return;
    }
    item.confirmed = true;
  }
  renderDetail();
}

function removeUnlisted(tempId) {
  State.unlistedItems = State.unlistedItems.filter(i => i.tempId !== tempId);
  renderDetail();
}

async function captureUnlistedSerial(tempId) {
  const item = State.unlistedItems.find(i => i.tempId === tempId);
  if (!item) return;
  let serial;
  try {
    const result = await Scanner.start({ purpose: 'serial' });
    serial = result.code;
  } catch (err) {
    if (err.message === 'cancelled') {
      const typed = window.prompt(`Serial number for ${item.sku || item.description}:`);
      if (!typed) return;
      serial = typed.trim();
    } else {
      toast(err.message, 'err');
      return;
    }
  }
  item.serial = serial;
  item.confirmed = true;
  renderDetail();
}

function updateProgress() {
  const po = State.selectedPO;
  const total = po.items.length;
  const done = po.items.filter(i => State.confirmations[i.id]?.confirmed).length;
  document.getElementById('detail-progress').textContent = `${done} / ${total}`;
}

function updateSubmitState() {
  const po = State.selectedPO;
  if (!po) return;
  const allConfirmed = po.items.every(i => State.confirmations[i.id]?.confirmed);
  const allSerialsHave = po.items.every(i =>
    !i.isEquipment || State.confirmations[i.id]?.serial
  );
  const hasDoc = !!State.vendorDocNumber;
  const ok = allConfirmed && allSerialsHave && hasDoc && !State.loading;

  document.getElementById('submit-btn').disabled = !ok;
  const hint = document.getElementById('submit-hint');
  if (!allConfirmed) hint.textContent = 'Confirm every line item to enable submit.';
  else if (!allSerialsHave) hint.textContent = 'Capture a serial for each equipment item.';
  else if (!hasDoc) hint.textContent = 'Enter the vendor invoice / document #.';
  else hint.textContent = 'Ready to submit.';
}

/* ============ SUBMIT ============ */
async function submitReceipt() {
  const po = State.selectedPO;
  if (!po) return;
  State.loading = true;
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('submit-hint').textContent = 'Submitting…';
  try {
    const result = await API.submitReceipt({
      poId: po.id,
      vendorDocNumber: State.vendorDocNumber,
      items: po.items.map(i => ({
        id: i.id,
        quantity: i.quantity,
        serial: State.confirmations[i.id]?.serial,
      })),
      unlistedItems: State.unlistedItems
        .filter(i => i.confirmed)
        .map(i => ({ skuId: i.skuId, quantity: i.quantity, serial: i.serial })),
    });
    document.getElementById('success-message').textContent =
      `Receipt ${result.receiptId} created for ${po.number}.`;
    showView('success');
    // refresh list in background so the just-received PO drops out
    loadPOList();
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    showView('error');
  } finally {
    State.loading = false;
    updateSubmitState();
  }
}

/* ============ UTIL ============ */
function escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatItemCount(items) {
  return items.reduce((n, i) => n + (i.quantity || 1), 0);
}
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatCurrency(n, dollar = false) {
  if (n == null || isNaN(n)) return '—';
  const s = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return dollar ? `$${s}` : s;
}
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ` toast-${kind}` : '');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}
