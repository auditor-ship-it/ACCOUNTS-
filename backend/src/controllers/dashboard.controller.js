import * as dashboardService from '../services/dashboard.service.js';

export async function getDashboard(req, res) {
  res.json(await dashboardService.getDashboardData());
}

export async function clearCache(req, res) {
  dashboardService.clearDashboardCache();
  res.json({ message: 'OK' });
}

export async function getReportSuite(req, res) {
  res.json(await dashboardService.getReportSuiteData(req.user.email));
}

export async function getMonthlyReport(req, res) {
  res.json(await dashboardService.getMonthlyReportData(req.user.email));
}

export async function getDeployedSummary(req, res) {
  res.json(await dashboardService.getDeployedSummaryData());
}

export async function getDeployedDetail(req, res) {
  const { month, category, type, size } = req.query;
  res.json(await dashboardService.getDeployedDetailData(month, category, type, size));
}
