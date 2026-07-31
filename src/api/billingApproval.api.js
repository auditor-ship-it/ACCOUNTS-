import client from './client.js';

/**
 * Wrappers for Monthly Billing Approval (LMS!.html ~6262-6312 —
 * initBillingApproval/fetchBillingApproval/renderBillingApproval/
 * approveCustBilling/approveSingleBilling; backend/src/routes/
 * receivables.routes.js -> receivables.service.js).
 *
 * PERMISSION NOTE: despite living on the "Billing Approval" page, the mutation
 * (approveMonthlyBilling) is gated server-side by checkActionPermission
 * ('receivables', ...) in receivables.service.js — NOT 'billing'. The read
 * endpoint (getMonthlyBillingApprovalData) has no checkActionPermission call
 * in the original and is open to any authenticated user, matching the route
 * file's own comment.
 */

export const getMonthlyBillingApprovalData = (month, year) =>
  client.get('/receivables/monthly-billing-approval', { params: { month, year } }).then((r) => r.data);

/**
 * containerNo + clientCode mirror the original's single call site
 * (approveCustBilling passes ('', m, y, code); approveSingleBilling passes
 * (container, m, y, '')) — exactly one of the two identifiers is non-empty.
 */
export const approveMonthlyBilling = (containerNo, month, year, clientCode) =>
  client.post('/receivables/approve-billing', { containerNo, month, year, clientCode }).then((r) => r.data);
