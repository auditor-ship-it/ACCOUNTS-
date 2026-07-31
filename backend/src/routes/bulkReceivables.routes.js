import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as bulkReceivablesController from '../controllers/bulkReceivables.controller.js';

const router = Router();
router.use(requireAuth);

// Mutation — requires the 'receivables' action permission, matching the
// original's checkActionPermission('receivables', ...) call.
router.post('/payment', requirePermission('receivables'), asyncHandler(bulkReceivablesController.savePayment));

export default router;
