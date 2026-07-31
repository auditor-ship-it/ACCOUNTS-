import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as approvalSummaryController from '../controllers/approvalSummary.controller.js';

const router = Router();
router.use(requireAuth);

// Read-only, no permission gate in the original (getApprovalSummaryData had none).
router.get('/', asyncHandler(approvalSummaryController.getSummary));

export default router;
