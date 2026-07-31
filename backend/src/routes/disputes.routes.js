import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as disputesController from '../controllers/disputes.controller.js';

const router = Router();
router.use(requireAuth);

// Read-only — no checkActionPermission in the original (getDisputeApprovalData).
router.get('/approval', asyncHandler(disputesController.approvalList));

// Mutations — require the 'receivables' action permission, matching each
// original function's checkActionPermission('receivables', ...) call.
router.post('/save', requirePermission('receivables'), asyncHandler(disputesController.save));
router.post('/approval/action', requirePermission('receivables'), asyncHandler(disputesController.approvalAction));

export default router;
