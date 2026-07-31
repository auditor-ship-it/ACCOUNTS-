import client from './client.js';

/**
 * Wrappers for the Billing Sales "pending transfer" workflow
 * (LMS!.html ~7219-7269; backend/src/routes/pendingBilling.routes.js).
 */
export const getPendingBillingData = () => client.get('/pending-billing').then((r) => r.data);

export const sendBackToBilling = (rowNum) =>
  client.post('/pending-billing/send-back', { rowNum }).then((r) => r.data);

export const transferToPendingBilling = (rowNum, userEmail) =>
  client.post('/pending-billing/transfer', { rowNum, userEmail }).then((r) => r.data);
