import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/permission.middleware.js';
import * as billingController from '../controllers/billing.controller.js';

const router = Router();
router.use(requireAuth);

// Read-only — no dedicated permission gate in the original (getBillingData).
router.get('/', asyncHandler(billingController.list));

router.post('/action', requirePermission('billing'), asyncHandler(billingController.saveAction));

/* ★ NEW — see billing.controller.js's uploadInvoiceFile doc comment: fills a
   gap left by this port (no HTTP equivalent of the original's shared
   uploadToDrive RPC existed), gated behind 'billing' since only a user who
   can act on billing should be creating Drive files destined for a billing
   row's attachment column. */
router.post('/upload', requirePermission('billing'), asyncHandler(billingController.uploadInvoiceFile));

/* ★ Admin / housekeeping / diagnostic tools — gated behind 'billing' permission.
   (whoOpensTheTemplate/debugFetchContainer had no permission check in the
   original since they were "run from the Apps Script editor" tools; gated
   here because they are now reachable over HTTP.) */
router.post('/admin/fetch-invoice-template', requirePermission('billing'), asyncHandler(billingController.fetchInvoiceTemplate));
router.get('/admin/who-opens-template', requirePermission('billing'), asyncHandler(billingController.whoOpensTemplate));
router.post('/admin/clean-orphan-rows', requirePermission('billing'), asyncHandler(billingController.cleanOrphanRows));
router.post('/admin/remove-duplicate-rows', requirePermission('billing'), asyncHandler(billingController.removeDuplicateRows));
router.get('/admin/debug-fetch-container', requirePermission('billing'), asyncHandler(billingController.debugFetchContainer));

/* ★ Cron-equivalent work functions, admin-triggerable now; see jobs/billingTriggers.js
   for the schedule these are meant to run on once node-cron is wired up centrally. */
router.post('/admin/auto-fetch-invoice', requirePermission('billing'), asyncHandler(billingController.autoFetchInvoice));
router.post('/admin/generate-advance-invoice', requirePermission('billing'), asyncHandler(billingController.generateAdvanceInvoice));
router.post('/admin/generate-end-invoice', requirePermission('billing'), asyncHandler(billingController.generateEndInvoice));
router.post('/admin/generate-invoice-by-type', requirePermission('billing'), asyncHandler(billingController.generateInvoiceByType));

export default router;
