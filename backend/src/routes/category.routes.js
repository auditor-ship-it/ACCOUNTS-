import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as categoryController from '../controllers/category.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/approve', asyncHandler(categoryController.getApprove));
router.post('/approve/:rowNum/action', asyncHandler(categoryController.saveApproveAction));

router.get('/billing', asyncHandler(categoryController.getBilling));
router.post('/billing/:rowNum/action', asyncHandler(categoryController.saveBillingAction));

router.get('/receivables', asyncHandler(categoryController.getReceivables));
router.post('/receivables/:rowNum/follow-up', asyncHandler(categoryController.saveFollowUp));
router.post('/receivables/:rowNum/payment', asyncHandler(categoryController.savePayment));

router.get('/statement-pivot', asyncHandler(categoryController.getStatementPivot));
router.get('/outstanding-pivot', asyncHandler(categoryController.getOutstandingPivot));

export default router;
