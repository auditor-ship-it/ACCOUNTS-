import client from './client.js';

/**
 * Cross-category "already approved" records (Lease / Sale-Spare-Transport /
 * Billing / Transportation) for the Approval Summary screen.
 * Port of getApprovalSummaryData (LMS!.html ~9363) — GET /api/approval-summary.
 */
export const getApprovalSummary = () => client.get('/approval-summary').then((r) => r.data);
