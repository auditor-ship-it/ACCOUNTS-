import client from './client.js';

/**
 * Outstanding View. The original UI's initOutstanding()/renderOutstandingPivot()
 * (LMS!.html 6053-6165) calls ONLY getOutstandingPivotData(outView), where
 * outView is 'customer' | 'container' (the two view-toggle buttons in
 * #outstanding .view-toggle). That RPC lives in receivablesCategory.service.js,
 * wired at category.routes.js's GET /api/category/outstanding-pivot
 * (confirmed by reading both files) — NOT receivables.routes.js's
 * similarly-named /outstanding-view.
 */
export const getOutstandingPivotData = (viewBy) =>
  client.get('/category/outstanding-pivot', { params: { viewBy } }).then((r) => r.data);

/**
 * DEAD-CODE NOTE: receivables.routes.js also exposes
 * getOutstandingViewData(month, year, viewBy) — confirmed by reading
 * receivables.controller.js / receivables.service.js — but it is never
 * called from LMS!.html. Wrapped here for completeness/future use; the
 * OutstandingViewPage does not call it.
 */
export const getOutstandingViewData = (month, year, viewBy) =>
  client.get('/receivables/outstanding-view', { params: { month, year, viewBy } }).then((r) => r.data);
