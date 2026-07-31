import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as receivablesController from '../controllers/receivables.controller.js';

const router = Router();
router.use(requireAuth);

// Reporting / read endpoints — open to any authenticated user, matching the
// original (getReceivablesLeaseData, getPaymentLog, getStatementMonths,
// getMonthlyStatementData, getOutstandingViewData,
// getMonthlyBillingApprovalData had no checkActionPermission call).
router.get('/lease-data', asyncHandler(receivablesController.getLeaseData));
router.get('/payment-log', asyncHandler(receivablesController.paymentLog));
router.get('/statement-months', asyncHandler(receivablesController.statementMonths));
router.get('/monthly-statement', asyncHandler(receivablesController.monthlyStatement));
router.get('/outstanding-view', asyncHandler(receivablesController.outstandingView));
router.get('/monthly-billing-approval', asyncHandler(receivablesController.monthlyBillingApproval));

// Mutations — require the 'receivables' action permission, matching each
// original function's checkActionPermission('receivables', ...) call.
router.post('/follow-up', requirePermission('receivables'), asyncHandler(receivablesController.saveFollowUp));
router.post('/client-follow-up', requirePermission('receivables'), asyncHandler(receivablesController.saveClientFollowUp));
router.post('/payment', requirePermission('receivables'), asyncHandler(receivablesController.savePayment));
router.post('/approve-billing', requirePermission('receivables'), asyncHandler(receivablesController.approveBilling));

export default router;
