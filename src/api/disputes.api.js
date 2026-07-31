import client from './client.js';

/**
 * Wrappers for the Dispute workflow (LMS!.html ~4912-5086, 5570-5805;
 * backend/src/routes/disputes.routes.js -> disputes.controller.js ->
 * disputes.service.js).
 *
 * getDisputeApprovalData — read-only, no checkActionPermission in the
 * original (route file comment confirms this), open to any authenticated user.
 *
 * saveDisputeApprovalAction / saveDispute — both mutations require the
 * 'receivables' action permission (checkActionPermission('receivables', ...)
 * in disputes.service.js), same permission that gates the Billing Approval
 * mutation, despite each living under a differently-named tab.
 */

export const getDisputeApprovalData = () => client.get('/disputes/approval').then((r) => r.data);

export const saveDisputeApprovalAction = (rowNum, status, userEmail) =>
  client.post('/disputes/approval/action', { rowNum, status, userEmail }).then((r) => r.data);

/**
 * Raises a NEW dispute. This is called from the Billing / Receivables pages
 * (where onDisputeAll/onDisputeSingle/onDisputeCat used to live in the
 * original), NOT from this Dispute Approval queue — that page is
 * approval-only. Per disputes.service.js's doc comment, those three original
 * functions were pure client-side argument-shaping helpers with no server
 * equivalent; whichever page raises a dispute must compute `mode`
 * ('lease' | 'category'), `identifiers` (container numbers for lease rows,
 * or `_rowNum`s for category/transport rows), and `source`
 * (currentRecvType, e.g. 'Lease' | 'Transportion' | other category name)
 * itself before calling this.
 */
export const saveDispute = ({ mode, identifiers, source, dispType, otherDesc, remarks, periodDate, attachUrls, timestamp, userEmail }) =>
  client.post('/disputes/save', { mode, identifiers, source, dispType, otherDesc, remarks, periodDate, attachUrls, timestamp, userEmail }).then((r) => r.data);
