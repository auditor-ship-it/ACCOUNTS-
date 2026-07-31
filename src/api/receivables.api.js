import client from './client.js';

/**
 * Wrappers for the Receivables workflow's three parallel implementations,
 * confirmed by reading each backend route file directly (not guessed):
 *   - 'Lease'                         -> plain "Receivables" sheet   (receivables.routes.js)
 *   - 'Transportion'                  -> Transportation sheet         (transport.routes.js)
 *   - Sale / Accessories / AMC / Other -> "Receivables other order Type"
 *     sheet, category.routes.js — server-side gated via checkActionPermission
 *     inside receivablesCategory.service.js rather than route middleware
 *     (category.routes.js has no requirePermission on these).
 * Matches the original's showRecvType()/fetchReceivablesCategory() dispatch
 * (LMS!.html ~7639-7676): Lease is its own UI; everything else (including
 * Transportion) shares the "category" list/detail/follow-up/pay UI, only the
 * RPC target differs per category.
 */
export const RECEIVABLES_CATEGORIES = ['Lease', 'Sale', 'Accessories', 'Transportion', 'AMC', 'Other'];

/* ===== Lease ===== */
export const getReceivablesLeaseData = (filterType) =>
  client.get('/receivables/lease-data', { params: { filterType } }).then((r) => r.data);

export const getPaymentLog = (containerNo) =>
  client.get('/receivables/payment-log', { params: { containerNo } }).then((r) => r.data);

export const saveReceivableFollowUp = ({ containerNo, timestamp, remarks, userEmail }) =>
  client.post('/receivables/follow-up', { containerNo, timestamp, remarks, userEmail }).then((r) => r.data);

export const saveReceivableClientFollowUp = ({ clientCode, timestamp, remarks, userEmail }) =>
  client.post('/receivables/client-follow-up', { clientCode, timestamp, remarks, userEmail }).then((r) => r.data);

export const saveReceivableLeasePayment = ({ containerNo, timestamp, amount, utr, remarks, userEmail, attachmentUrl }) =>
  client.post('/receivables/payment', { containerNo, timestamp, amount, utr, remarks, userEmail, attachmentUrl }).then((r) => r.data);

/* ===== Transportion ===== */
export const getReceivablesTransportData = (filterType) =>
  client.get('/transport/receivables', { params: { filterType } }).then((r) => r.data);

export const saveReceivableTransportFollowUp = (rowNum, { timestamp, remarks, userEmail }) =>
  client.post(`/transport/receivables/${rowNum}/follow-up`, { timestamp, remarks, userEmail }).then((r) => r.data);

export const saveReceivableTransportPayment = (rowNum, { timestamp, amount, utr, remarks, userEmail, attachmentUrl }) =>
  client.post(`/transport/receivables/${rowNum}/payment`, { timestamp, amount, utr, remarks, userEmail, attachmentUrl }).then((r) => r.data);

/* ===== "Other Order Type" categories: Sale / Accessories / AMC / Other ===== */
export const getReceivablesCategoryData = (category, filterType) =>
  client.get('/category/receivables', { params: { category, filterType } }).then((r) => r.data);

export const saveReceivableCategoryFollowUp = (rowNum, { timestamp, remarks, userEmail }) =>
  client.post(`/category/receivables/${rowNum}/follow-up`, { timestamp, remarks, userEmail }).then((r) => r.data);

export const saveReceivableCategoryPayment = (rowNum, { timestamp, amount, utr, remarks, userEmail, attachmentUrl }) =>
  client.post(`/category/receivables/${rowNum}/payment`, { timestamp, amount, utr, remarks, userEmail, attachmentUrl }).then((r) => r.data);

/* ===== Category dispatch helpers — mirror fetchReceivablesCategory()'s branch ===== */
export const getReceivablesForCategory = (category, filterType) =>
  category === 'Transportion'
    ? getReceivablesTransportData(filterType)
    : getReceivablesCategoryData(category, filterType);

export const saveFollowUpForCategory = (category, rowNum, payload) =>
  category === 'Transportion'
    ? saveReceivableTransportFollowUp(rowNum, payload)
    : saveReceivableCategoryFollowUp(rowNum, payload);

export const savePaymentForCategory = (category, rowNum, payload) =>
  category === 'Transportion'
    ? saveReceivableTransportPayment(rowNum, payload)
    : saveReceivableCategoryPayment(rowNum, payload);

/* ===== Bulk payment (Lease only) — POST /api/receivables-bulk/payment =====
 * DEVIATION from the single-row payment endpoints above: this one does its
 * OWN server-side Drive upload (base64Data/mimeType/fileName), it does not
 * accept a pre-uploaded attachmentUrl — confirmed by reading
 * bulkReceivables.controller.js / .service.js directly. Do not call
 * uploadFileToDrive() first for this flow. */
export const saveBulkReceivablePayment = ({ containerNos, timestamp, amount, utr, remarks, userEmail, base64Data, mimeType, fileName }) =>
  client.post('/receivables-bulk/payment', { containerNos, timestamp, amount, utr, remarks, userEmail, base64Data, mimeType, fileName }).then((r) => r.data);
