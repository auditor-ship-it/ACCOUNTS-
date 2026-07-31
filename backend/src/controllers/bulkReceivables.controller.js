import * as bulkReceivablesService from '../services/bulkReceivables.service.js';

/** POST /api/receivables-bulk/payment — saveBulkReceivablePayment (LMS.js 5807) */
export async function savePayment(req, res) {
  const { containerNos, timestamp, amount, utr, remarks, userEmail, base64Data, mimeType, fileName } = req.body;
  const message = await bulkReceivablesService.saveBulkReceivablePayment(containerNos, timestamp, amount, utr, remarks, userEmail, base64Data, mimeType, fileName, req.user.email);
  res.json({ message });
}
