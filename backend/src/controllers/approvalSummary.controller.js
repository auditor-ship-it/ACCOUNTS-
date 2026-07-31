import { getApprovalSummaryData } from '../services/approvalSummary.service.js';

/** GET /api/approval-summary */
export async function getSummary(req, res) {
  res.json(await getApprovalSummaryData());
}
