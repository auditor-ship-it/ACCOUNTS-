import * as billingService from '../services/billing.service.js';
import { uploadToDrive } from '../services/googleDrive.service.js';

/** GET /api/billing */
export async function list(req, res) {
  res.json(await billingService.getBillingData());
}

/** POST /api/billing/upload — NEW endpoint filling a gap in this port: the
 * original UI called the shared global uploadToDrive(base64Data, mimeType,
 * fileName) RPC directly (LMS.js, google.script.run.uploadToDrive) before
 * every saveBillingAction/saveBillingTransportAction/saveBillingCategoryAction/
 * saveBulkBillingAction call, across all billing categories. No HTTP endpoint
 * for that shared step existed yet anywhere in the backend (verify/expiry
 * each ported a container/docType-specific variant instead), so it's added
 * here since the Billing Sales + Pending Billing UI depends on it for every
 * invoice-attachment upload (single-row and bulk). Reuses the already-tested
 * googleDrive.service.js uploadToDrive() — no new Drive logic. */
export async function uploadInvoiceFile(req, res) {
  const { base64Data, mimeType, fileName } = req.body;
  const url = await uploadToDrive(base64Data, mimeType, fileName);
  res.json({ url });
}

/** POST /api/billing/action — saveBillingAction (LMS.js 1543) */
export async function saveAction(req, res) {
  const { rowNum, timestamp, attachmentUrl, userEmail, invoiceNo } = req.body;
  res.json({ result: await billingService.saveBillingAction(rowNum, timestamp, attachmentUrl, userEmail, invoiceNo, req.user.email) });
}

/* ===== Admin / housekeeping / cron-callable endpoints ===== */

export async function fetchInvoiceTemplate(req, res) {
  res.json({ result: await billingService.fetchBillingInvoiceFromTemplate(req.user.email) });
}

export async function whoOpensTemplate(req, res) {
  res.json({ result: await billingService.whoOpensTheTemplate() });
}

export async function cleanOrphanRows(req, res) {
  res.json({ result: await billingService.cleanOrphanBillingRows(req.user.email) });
}

export async function removeDuplicateRows(req, res) {
  res.json({ result: await billingService.removeDuplicateBillingRows(req.user.email) });
}

export async function debugFetchContainer(req, res) {
  const containerNo = req.query.containerNo || req.body?.containerNo;
  res.json({ result: await billingService.debugFetchContainer(containerNo) });
}

export async function autoFetchInvoice(req, res) {
  await billingService.autoFetchBillingInvoice();
  res.json({ ok: true });
}

export async function generateAdvanceInvoice(req, res) {
  res.json(await billingService.generateAdvanceInvoice());
}

export async function generateEndInvoice(req, res) {
  res.json(await billingService.generateEndInvoice());
}

export async function generateInvoiceByType(req, res) {
  const { billingType } = req.body;
  res.json(await billingService.generateInvoiceByType(billingType));
}
