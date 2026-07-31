import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as dashboardController from '../controllers/dashboard.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(dashboardController.getDashboard));
router.post('/clear-cache', asyncHandler(dashboardController.clearCache));
router.get('/report-suite', asyncHandler(dashboardController.getReportSuite));
router.get('/monthly-report', asyncHandler(dashboardController.getMonthlyReport));
router.get('/deployed-summary', asyncHandler(dashboardController.getDeployedSummary));
router.get('/deployed-detail', asyncHandler(dashboardController.getDeployedDetail));

export default router;
