import express from 'express';
import cors from 'cors';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import { responseCache } from './middlewares/responseCache.middleware.js';
import { requestLogger } from './middlewares/requestLogger.middleware.js';
import { optionalAuth } from './middlewares/auth.middleware.js';

import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import categoryRoutes from './routes/category.routes.js';
import billingRoutes from './routes/billing.routes.js';
import receivablesRoutes from './routes/receivables.routes.js';
import transportRoutes from './routes/transport.routes.js';
import approvalSummaryRoutes from './routes/approvalSummary.routes.js';
import disputesRoutes from './routes/disputes.routes.js';
import pendingBillingRoutes from './routes/pendingBilling.routes.js';
import bulkReceivablesRoutes from './routes/bulkReceivables.routes.js';

/**
 * Accounts & Collection's own, standalone backend — a narrower copy of the
 * original shared backend/src/app.js carrying only the 11 route modules
 * accounts-collection's frontend actually calls (auth, uploads, dashboard,
 * category, billing, receivables, transport, approval-summary, disputes,
 * pending-billing, receivables-bulk). No verify/approve/expiry/offlease/
 * roles/tasks/autofill/pipeline/apiV1/apiAdmin routes here — those belong to
 * Lease Management or the Original Application. See splendid-rolling-candy.md Phase 2.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '25mb' })); // generous limit: base64 file uploads pass through JSON bodies

  // First in the chain — establishes the per-request logging context every
  // downstream Mongo/Sheets access reports into (see requestContext.js).
  app.use(requestLogger);

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'accounts-collection-backend' }));

  // Resolves req.user (if a valid session token is present) for every request,
  // then serves/populates the per-user response cache + global quota-lockout
  // guard below — see responseCache.middleware.js. Each route's own
  // requireAuth still rejects genuinely unauthenticated requests.
  app.use(optionalAuth);
  app.use(responseCache);

  app.use('/api/uploads', uploadRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/category', categoryRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/receivables', receivablesRoutes);
  app.use('/api/transport', transportRoutes);
  app.use('/api/approval-summary', approvalSummaryRoutes);
  app.use('/api/disputes', disputesRoutes);
  app.use('/api/pending-billing', pendingBillingRoutes);
  app.use('/api/receivables-bulk', bulkReceivablesRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
