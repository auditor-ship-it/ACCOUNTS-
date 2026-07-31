import client from './client.js';

/**
 * Monthly Statement. The original UI's initStatement()/renderStatementPivot()
 * (LMS!.html 5913-6048) calls ONLY getStatementPivotData() — a container ×
 * month pivot with no month/year/viewBy selector. That RPC lives in
 * receivablesCategory.service.js and is wired at category.routes.js's
 * GET /api/category/statement-pivot (confirmed by reading both files), NOT
 * on receivables.routes.js despite the "Statement"-sounding name of the
 * sibling endpoints below.
 */
export const getStatementPivotData = () =>
  client.get('/category/statement-pivot').then((r) => r.data);

/**
 * DEAD-CODE NOTE: receivables.routes.js also exposes getStatementMonths /
 * getMonthlyStatementData(month, year, viewBy) — confirmed by reading
 * receivables.controller.js / receivables.service.js — but grepping LMS!.html
 * shows neither is ever called from any client function. They appear to be
 * unused/legacy endpoints (possibly reserved for a future month-filtered
 * statement view). Wrapped here for completeness/future use; the
 * MonthlyStatementPage does not call them.
 */
export const getStatementMonths = () =>
  client.get('/receivables/statement-months').then((r) => r.data);

export const getMonthlyStatementData = (month, year, viewBy) =>
  client.get('/receivables/monthly-statement', { params: { month, year, viewBy } }).then((r) => r.data);
