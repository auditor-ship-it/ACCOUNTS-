import client from './client.js';

/**
 * Wrappers for the three Billing Sales category variants the original UI's
 * fetchBillingTab(category)/saveBilling() switched on (LMS!.html ~7339-7628):
 *   - 'Lease'                -> plain Billing Sales sheet   (billing.routes.js)
 *   - 'Transportion'         -> Transportation sheet         (transport.routes.js)
 *   - everything else        -> "Other Order Type" categories: Sale,
 *     Accessories, AMC, Other -> Billing Category sheet      (category.routes.js)
 * Bulk upload (saveBulkBillingAction) fans out across all three server-side
 * and lives on transport.routes.js per an earlier porting decision — confirmed
 * by reading backend/src/routes/transport.routes.js + transport.service.js.
 */

/* ===== Lease ===== */
export const getBillingData = () => client.get('/billing').then((r) => r.data);

export const saveBillingAction = ({ rowNum, timestamp, attachmentUrl, userEmail, invoiceNo }) =>
  client.post('/billing/action', { rowNum, timestamp, attachmentUrl, userEmail, invoiceNo }).then((r) => r.data);

/* ===== Transportion ===== */
export const getBillingTransportData = () => client.get('/transport/billing').then((r) => r.data);

export const saveBillingTransportAction = (rowNum, { timestamp, attachmentUrl, userEmail, invoiceNo }) =>
  client.post(`/transport/billing/${rowNum}/action`, { timestamp, attachmentUrl, userEmail, invoiceNo }).then((r) => r.data);

/* ===== Bulk — fans out across Lease / Transportion / other category sheets ===== */
export const saveBulkBillingAction = ({ identifiers, timestamp, attachmentUrl, userEmail, invoiceNo, category }) =>
  client.post('/transport/billing/bulk-action', { identifiers, timestamp, attachmentUrl, userEmail, invoiceNo, category }).then((r) => r.data);

/* ===== "Other Order Type" categories: Sale / Accessories / AMC / Other ===== */
export const getBillingCategoryData = (category) =>
  client.get('/category/billing', { params: { category } }).then((r) => r.data);

export const saveBillingCategoryAction = (rowNum, { timestamp, attachmentUrl, userEmail, category, invoiceNo }) =>
  client.post(`/category/billing/${rowNum}/action`, { timestamp, attachmentUrl, userEmail, category, invoiceNo }).then((r) => r.data);

/* ===== Invoice Template fetch (the "Fetch Invoice / Attachment" button) ===== */
export const fetchBillingInvoiceFromTemplate = () =>
  client.post('/billing/admin/fetch-invoice-template').then((r) => r.data);

/* ===== File upload -> Drive URL (NEW backend endpoint; see billing.controller.js) =====
 * Every billing upload flow (single-row, all 3 categories, and bulk) needs a
 * Drive URL before it can call the save-action endpoints above — this mirrors
 * the original's two-step "uploadToDrive() then saveXAction(...url)" flow. */
export const uploadInvoiceFile = ({ base64Data, mimeType, fileName }) =>
  client.post('/billing/upload', { base64Data, mimeType, fileName }).then((r) => r.data);
