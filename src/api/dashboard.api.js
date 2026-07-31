import client from './client.js';

/** Main dashboard KPIs + charts data (60s server-cached). */
export const getDashboardData = () => client.get('/dashboard').then((r) => r.data);

/** Force the server to drop its 60s dashboard/my-task cache and recompute. */
export const clearDashboardCache = () => client.post('/dashboard/clear-cache').then((r) => r.data);

/** MIS/CFO/CEO report suite (insights, AR ageing, collection efficiency, etc). */
export const getReportSuite = () => client.get('/dashboard/report-suite').then((r) => r.data);

/** Alias of report-suite kept for the original "Monthly Report" tab. */
export const getMonthlyReport = () => client.get('/dashboard/monthly-report').then((r) => r.data);

/** Deployed containers summary: opening/addition/deletion/net/closing per month. */
export const getDeployedSummary = () => client.get('/dashboard/deployed-summary').then((r) => r.data);

/** Container-level drill-down for one deployed-summary month/category/type/size cell. */
export const getDeployedDetail = (month, category, type, size) =>
  client.get('/dashboard/deployed-detail', { params: { month, category, type, size } }).then((r) => r.data);
