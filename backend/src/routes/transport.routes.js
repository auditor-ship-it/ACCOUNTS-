import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as transportController from '../controllers/transport.controller.js';

const router = Router();
router.use(requireAuth);

// Read-only — no permission gate in the original (getApproveTransportData /
// getBillingTransportData / getReceivablesTransportData had none).
router.get('/approve', asyncHandler(transportController.getApprove));
router.get('/billing', asyncHandler(transportController.getBilling));
router.get('/receivables', asyncHandler(transportController.getReceivables));

// Mutations — gated on the same 'approve' / 'billing' / 'receivables' action
// types the plain-Lease versions use, matching each original function's
// checkActionPermission(...) call.
router.post('/approve/:rowNum/action', requirePermission('approve'), asyncHandler(transportController.saveApproveAction));

router.post('/billing/:rowNum/action', requirePermission('billing'), asyncHandler(transportController.saveBillingAction));
router.post('/billing/bulk-action', requirePermission('billing'), asyncHandler(transportController.bulkBillingAction));

router.post('/receivables/:rowNum/follow-up', requirePermission('receivables'), asyncHandler(transportController.saveFollowUp));
router.post('/receivables/:rowNum/payment', requirePermission('receivables'), asyncHandler(transportController.savePayment));

export default router;
