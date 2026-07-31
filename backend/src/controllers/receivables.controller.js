import * as receivablesService from '../services/receivables.service.js';

// ===== Read / reporting endpoints =====

export async function getLeaseData(req, res) {
  const { filterType } = req.query;
  res.json(await receivablesService.getReceivablesLeaseData(filterType));
}

export async function paymentLog(req, res) {
  const { containerNo } = req.query;
  res.json(await receivablesService.getPaymentLog(containerNo));
}

export async function statementMonths(req, res) {
  res.json(await receivablesService.getStatementMonths());
}

export async function monthlyStatement(req, res) {
  const { month, year, viewBy } = req.query;
  res.json(await receivablesService.getMonthlyStatementData(month, year, viewBy));
}

export async function outstandingView(req, res) {
  const { month, year, viewBy } = req.query;
  res.json(await receivablesService.getOutstandingViewData(month, year, viewBy));
}

export async function monthlyBillingApproval(req, res) {
  const { month, year } = req.query;
  res.json(await receivablesService.getMonthlyBillingApprovalData(month, year));
}

// ===== Mutations =====

export async function saveFollowUp(req, res) {
  const { containerNo, timestamp, remarks, userEmail } = req.body;
  res.json({ message: await receivablesService.saveReceivableFollowUp(containerNo, timestamp, remarks, userEmail) });
}

export async function saveClientFollowUp(req, res) {
  const { clientCode, timestamp, remarks, userEmail } = req.body;
  res.json({ message: await receivablesService.saveReceivableClientFollowUp(clientCode, timestamp, remarks, userEmail) });
}

export async function savePayment(req, res) {
  const { containerNo, timestamp, amount, utr, remarks, userEmail, attachmentUrl } = req.body;
  const status = await receivablesService.saveReceivableLeasePayment(containerNo, timestamp, amount, utr, remarks, userEmail, attachmentUrl);
  res.json({ status });
}

export async function approveBilling(req, res) {
  const { containerNo, month, year, clientCode } = req.body;
  const message = await receivablesService.approveMonthlyBilling(containerNo, month, year, clientCode, req.user.email);
  res.json({ message });
}
