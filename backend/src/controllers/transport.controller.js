import * as transportService from '../services/transport.service.js';

/* ===== Approve ===== */

/** GET /api/transport/approve */
export async function getApprove(req, res) {
  res.json(await transportService.getApproveTransportData());
}

/** POST /api/transport/approve/:rowNum/action */
export async function saveApproveAction(req, res) {
  const { timestamp, status, userEmail } = req.body;
  const result = await transportService.saveApproveTransportAction(req.params.rowNum, timestamp, status, userEmail);
  res.json({ result });
}

/* ===== Billing ===== */

/** GET /api/transport/billing */
export async function getBilling(req, res) {
  res.json(await transportService.getBillingTransportData());
}

/** POST /api/transport/billing/:rowNum/action */
export async function saveBillingAction(req, res) {
  const { timestamp, attachmentUrl, userEmail, invoiceNo } = req.body;
  const result = await transportService.saveBillingTransportAction(req.params.rowNum, timestamp, attachmentUrl, userEmail, invoiceNo);
  res.json({ result });
}

/** POST /api/transport/billing/bulk-action — fans out across Lease/Transportion/Other categories */
export async function bulkBillingAction(req, res) {
  const { identifiers, timestamp, attachmentUrl, userEmail, invoiceNo, category } = req.body;
  const message = await transportService.saveBulkBillingAction(identifiers, timestamp, attachmentUrl, userEmail, invoiceNo, category);
  res.json({ message });
}

/* ===== Receivables ===== */

/** GET /api/transport/receivables */
export async function getReceivables(req, res) {
  const { filterType } = req.query;
  res.json(await transportService.getReceivablesTransportData(filterType));
}

/** POST /api/transport/receivables/:rowNum/follow-up */
export async function saveFollowUp(req, res) {
  const { timestamp, remarks, userEmail } = req.body;
  const result = await transportService.saveReceivableTransportFollowUp(req.params.rowNum, timestamp, remarks, userEmail);
  res.json({ result });
}

/** POST /api/transport/receivables/:rowNum/payment */
export async function savePayment(req, res) {
  const { timestamp, amount, utr, remarks, userEmail, attachmentUrl } = req.body;
  const status = await transportService.saveReceivableTransportPayment(req.params.rowNum, timestamp, amount, utr, remarks, userEmail, attachmentUrl);
  res.json({ status });
}
