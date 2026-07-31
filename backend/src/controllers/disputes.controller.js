import * as disputesService from '../services/disputes.service.js';

/** POST /api/disputes/save — saveDispute (LMS.js 5589) */
export async function save(req, res) {
  const { mode, identifiers, source, dispType, otherDesc, remarks, periodDate, attachUrls, timestamp, userEmail } = req.body;
  const message = await disputesService.saveDispute(mode, identifiers, source, dispType, otherDesc, remarks, periodDate, attachUrls, timestamp, userEmail, req.user.email);
  res.json({ message });
}

/** GET /api/disputes/approval — getDisputeApprovalData (LMS.js 5714) */
export async function approvalList(req, res) {
  res.json(await disputesService.getDisputeApprovalData());
}

/** POST /api/disputes/approval/action — saveDisputeApprovalAction (LMS.js 5755) */
export async function approvalAction(req, res) {
  const { rowNum, status, userEmail } = req.body;
  const result = await disputesService.saveDisputeApprovalAction(rowNum, status, userEmail, req.user.email);
  res.json({ result });
}
