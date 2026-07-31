import * as approveCategoryService from '../services/approveCategory.service.js';
import * as billingCategoryService from '../services/billingCategory.service.js';
import * as receivablesCategoryService from '../services/receivablesCategory.service.js';

/* ---- Approve category ---- */
export async function getApprove(req, res) {
  res.json(await approveCategoryService.getApproveCategoryData(req.query.category));
}

export async function saveApproveAction(req, res) {
  const { timestamp, status, userEmail, category } = req.body;
  const result = await approveCategoryService.saveApproveCategoryAction(
    req.user.email, Number(req.params.rowNum), timestamp, status, userEmail, category
  );
  res.json({ result });
}

/* ---- Billing category ---- */
export async function getBilling(req, res) {
  res.json(await billingCategoryService.getBillingCategoryData(req.query.category));
}

export async function saveBillingAction(req, res) {
  const { timestamp, attachmentUrl, userEmail, category, invoiceNo } = req.body;
  const result = await billingCategoryService.saveBillingCategoryAction(
    req.user.email, Number(req.params.rowNum), timestamp, attachmentUrl, userEmail, category, invoiceNo
  );
  res.json({ result });
}

/* ---- Receivables category ---- */
export async function getReceivables(req, res) {
  res.json(await receivablesCategoryService.getReceivablesCategoryData(req.query.category, req.query.filterType));
}

export async function saveFollowUp(req, res) {
  const { timestamp, remarks, userEmail } = req.body;
  const result = await receivablesCategoryService.saveReceivableCategoryFollowUp(
    req.user.email, Number(req.params.rowNum), timestamp, remarks, userEmail
  );
  res.json({ result });
}

export async function savePayment(req, res) {
  const { timestamp, amount, utr, remarks, userEmail, attachmentUrl } = req.body;
  const result = await receivablesCategoryService.saveReceivableCategoryPayment(
    req.user.email, Number(req.params.rowNum), timestamp, amount, utr, remarks, userEmail, attachmentUrl
  );
  res.json({ result });
}

export async function getStatementPivot(req, res) {
  res.json(await receivablesCategoryService.getStatementPivotData());
}

export async function getOutstandingPivot(req, res) {
  res.json(await receivablesCategoryService.getOutstandingPivotData(req.query.viewBy));
}
