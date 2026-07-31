/**
 * Port of LMS.js lines 4174-4244 (Billing "other order type" category
 * workflow): getBillingCategoryData, saveBillingCategoryAction.
 *
 * IMPORTANT: this operates on the "Approve billing for invoice" sheet
 * (SHEETS.BILLING_CATEGORY) — a DIFFERENT sheet than the plain-Lease Billing
 * workflow (SHEETS.BILLING_SALES, ported elsewhere into billing.service.js).
 * The original keeps these as separate functions and so does this port; a
 * future cleanup could unify them.
 */
import { getSheetData, updateRange, updateCell, getRange, colLetter, findColByHeader } from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, buildDisplayRow } from '../utils/format.js';
import { checkActionPermission } from './permissions.service.js';
import { withSheetLock } from '../utils/sheetMutex.js';

const BILLING_CATEGORY_SHEET = SHEETS.BILLING_CATEGORY; // 'Approve billing for invoice'
const BILLING_TYPE_MATCH = { Sale: 'sale', Accessories: ['spare', 'accessories'], Transportion: 'transport', AMC: 'amc', Other: null };

function lastColOf(headers, rows) {
  let n = headers.length;
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

function matchesCategory(matchKey, rowType) {
  if (matchKey === null) {
    return !(rowType.indexOf('sale') !== -1 || rowType.indexOf('spare') !== -1 || rowType.indexOf('accessories') !== -1 || rowType.indexOf('transport') !== -1 || rowType.indexOf('amc') !== -1);
  }
  return Array.isArray(matchKey) ? matchKey.some((k) => rowType.indexOf(k) !== -1) : rowType.indexOf(matchKey) !== -1;
}

export async function getBillingCategoryData(category) {
  let sheetData;
  try {
    sheetData = await getSheetData(BILLING_CATEGORY_SHEET);
  } catch (e) {
    return { headers: [], data: [], stageIdx: -1, missing: true, sheetName: BILLING_CATEGORY_SHEET };
  }
  let { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [], stageIdx: -1 };

  let lastCol = lastColOf(headers, rows);
  let attachCol = findColByHeader(headers, 'Billing Attachment');
  let billingTsCol = findColByHeader(headers, 'Billing Timestamp');
  let billingUserCol = findColByHeader(headers, 'Billing User');

  const toAppend = [];
  if (attachCol === -1) { attachCol = lastCol + toAppend.length; toAppend.push('Billing Attachment'); }
  if (billingTsCol === -1) { billingTsCol = lastCol + toAppend.length; toAppend.push('Billing Timestamp'); }
  if (billingUserCol === -1) { billingUserCol = lastCol + toAppend.length; toAppend.push('Billing User'); }
  if (toAppend.length > 0) {
    await updateRange(BILLING_CATEGORY_SHEET, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    headers = [...headers, ...toAppend];
    lastCol = headers.length;
  }

  const matchKey = BILLING_TYPE_MATCH[category];
  const finalData = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).trim() === '') continue;
    if (attachCol >= 0 && row[attachCol] && String(row[attachCol]).trim() !== '') continue;
    const rowType = String(row[3] || '').trim().toLowerCase();
    if (!matchesCategory(matchKey, rowType)) continue;
    finalData.push({ row: buildDisplayRow(row, Math.min(10, lastCol), headers), _rowNum: i + 2 });
  }
  return { headers: headers.slice(0, 10).map((h) => safeStr(h)), data: finalData, stageIdx: -1 };
}

/** callerEmail = authenticated user, used only for the permission check ('billing'). category is accepted for
 *  signature parity with the original but is unused in its body there too (only the read side filters by it). */
export async function saveBillingCategoryAction(callerEmail, rowNum, timestamp, attachmentUrl, userEmail, category, invoiceNo) {
  await checkActionPermission('billing', callerEmail);
  if (!rowNum || isNaN(rowNum)) throw new Error('Invalid row reference');

  return withSheetLock(BILLING_CATEGORY_SHEET, async () => {
    const { headers } = await getSheetData(BILLING_CATEGORY_SHEET);
    let lastCol = headers.length;
    let attachCol = findColByHeader(headers, 'Billing Attachment');
    let billingTsCol = findColByHeader(headers, 'Billing Timestamp');
    let billingUserCol = findColByHeader(headers, 'Billing User');
    let invCol = findColByHeader(headers, 'Invoice No');

    const toAppend = [];
    if (attachCol === -1) { attachCol = lastCol + toAppend.length; toAppend.push('Billing Attachment'); }
    if (billingTsCol === -1) { billingTsCol = lastCol + toAppend.length; toAppend.push('Billing Timestamp'); }
    if (billingUserCol === -1) { billingUserCol = lastCol + toAppend.length; toAppend.push('Billing User'); }
    if (invCol === -1) { invCol = lastCol + toAppend.length; toAppend.push('Invoice No'); }
    if (toAppend.length > 0) {
      await updateRange(BILLING_CATEGORY_SHEET, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    }

    if (attachCol >= 0) {
      const cur = (await getRange(BILLING_CATEGORY_SHEET, `${colLetter(attachCol)}${rowNum}:${colLetter(attachCol)}${rowNum}`))?.[0]?.[0];
      if (cur && String(cur).trim() !== '') return 'ALREADY_PROCESSED';
    }
    if (billingTsCol >= 0) await updateCell(BILLING_CATEGORY_SHEET, rowNum, billingTsCol, new Date(timestamp).toISOString());
    if (attachCol >= 0) await updateCell(BILLING_CATEGORY_SHEET, rowNum, attachCol, attachmentUrl || '');
    if (billingUserCol >= 0) await updateCell(BILLING_CATEGORY_SHEET, rowNum, billingUserCol, userEmail || '');
    if (invCol >= 0) await updateCell(BILLING_CATEGORY_SHEET, rowNum, invCol, invoiceNo || '');
    return 'OK';
  });
}
