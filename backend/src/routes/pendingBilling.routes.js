import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as pendingBillingController from '../controllers/pendingBilling.controller.js';

const router = Router();
router.use(requireAuth);

// Read-only — no checkActionPermission in the original (getPendingBillingData).
router.get('/', asyncHandler(pendingBillingController.list));

// Mutations — require the 'billing' action permission, matching each
// original function's checkActionPermission('billing', ...) call.
router.post('/send-back', requirePermission('billing'), asyncHandler(pendingBillingController.sendBack));
router.post('/transfer', requirePermission('billing'), asyncHandler(pendingBillingController.transfer));

export default router;
