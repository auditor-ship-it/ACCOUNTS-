import * as pendingBillingService from '../services/pendingBilling.service.js';

/** GET /api/pending-billing — getPendingBillingData (LMS.js 5518) */
export async function list(req, res) {
  res.json(await pendingBillingService.getPendingBillingData());
}

/** POST /api/pending-billing/send-back — sendBackToBilling (LMS.js 5472) */
export async function sendBack(req, res) {
  const { rowNum } = req.body;
  const result = await pendingBillingService.sendBackToBilling(rowNum, req.user.email);
  res.json({ result });
}

/** POST /api/pending-billing/transfer — transferToPendingBilling (LMS.js 5488) */
export async function transfer(req, res) {
  const { rowNum, userEmail } = req.body;
  const result = await pendingBillingService.transferToPendingBilling(rowNum, userEmail, req.user.email);
  res.json({ result });
}
