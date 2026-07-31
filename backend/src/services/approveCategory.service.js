/**
 * Port of LMS.js lines 4109-4171 (Approve "other order type" category
 * workflow): getApproveCategoryData, saveApproveCategoryAction.
 *
 * IMPORTANT: this operates on the "New Lease Other Order type" sheet
 * (SHEETS.APPROVE_BILLING) — a DIFFERENT sheet than the plain-Lease Approve
 * workflow (SHEETS.NEW_LEASE / SHEETS.OPERATION, ported elsewhere into
 * approve.service.js). The original keeps these as separate functions and
 * so does this port; a future cleanup could unify them.
 */
import { getSheetData, updateRange, updateCell, getRange, colLetter, findColByHeader } from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, buildDisplayRow } from '../utils/format.js';
import { checkActionPermission } from './permissions.service.js';
import { withSheetLock } from '../utils/sheetMutex.js';

const APPROVE_BILLING_SHEET = SHEETS.APPROVE_BILLING; // 'New Lease Other Order type'
const APPROVE_TYPE_MATCH = { Sale: 'sale', Accessories: ['spare', 'accessories'], Transportion: 'transport', AMC: 'amc', Other: null };

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

export async function getApproveCategoryData(category) {
  let sheetData;
  try {
    sheetData = await getSheetData(APPROVE_BILLING_SHEET);
  } catch (e) {
    return { headers: [], data: [], missing: true, sheetName: APPROVE_BILLING_SHEET };
  }
  let { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [] };

  let lastCol = lastColOf(headers, rows);
  let statusCol = findColByHeader(headers, 'Approve Status');
  let tsCol = findColByHeader(headers, 'Approve Timestamp');
  let userCol = findColByHeader(headers, 'Approve User');

  const toAppend = [];
  if (statusCol === -1) { statusCol = lastCol + toAppend.length; toAppend.push('Approve Status'); }
  if (tsCol === -1) { tsCol = lastCol + toAppend.length; toAppend.push('Approve Timestamp'); }
  if (userCol === -1) { userCol = lastCol + toAppend.length; toAppend.push('Approve User'); }
  if (toAppend.length > 0) {
    await updateRange(APPROVE_BILLING_SHEET, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    headers = [...headers, ...toAppend];
    lastCol = headers.length;
  }

  const matchKey = APPROVE_TYPE_MATCH[category];
  const finalData = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).trim() === '') continue;
    if (statusCol >= 0 && String(row[statusCol] || '').trim().toLowerCase() === 'approved') continue;
    const rowType = String(row[3] || '').trim().toLowerCase();
    if (!matchesCategory(matchKey, rowType)) continue;
    finalData.push({ row: buildDisplayRow(row, Math.min(10, lastCol), headers), _rowNum: i + 2 });
  }
  return { headers: headers.slice(0, 10).map((h) => safeStr(h)), data: finalData };
}

/** callerEmail = authenticated user, used only for the permission check ('approve'). category is accepted for
 *  signature parity with the original but is unused in its body there too (only the read side filters by it). */
export async function saveApproveCategoryAction(callerEmail, rowNum, timestamp, status, userEmail, category) {
  await checkActionPermission('approve', callerEmail);
  if (!rowNum || isNaN(rowNum)) throw new Error('Invalid row reference');

  return withSheetLock(APPROVE_BILLING_SHEET, async () => {
    const { headers } = await getSheetData(APPROVE_BILLING_SHEET);
    let lastCol = headers.length;
    let statusCol = findColByHeader(headers, 'Approve Status');
    let tsCol = findColByHeader(headers, 'Approve Timestamp');
    let userCol = findColByHeader(headers, 'Approve User');

    const toAppend = [];
    if (statusCol === -1) { statusCol = lastCol + toAppend.length; toAppend.push('Approve Status'); }
    if (tsCol === -1) { tsCol = lastCol + toAppend.length; toAppend.push('Approve Timestamp'); }
    if (userCol === -1) { userCol = lastCol + toAppend.length; toAppend.push('Approve User'); }
    if (toAppend.length > 0) {
      await updateRange(APPROVE_BILLING_SHEET, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    }

    if (statusCol >= 0) {
      const cur = (await getRange(APPROVE_BILLING_SHEET, `${colLetter(statusCol)}${rowNum}:${colLetter(statusCol)}${rowNum}`))?.[0]?.[0];
      if (cur && String(cur).trim().toLowerCase() === 'approved') return 'ALREADY_PROCESSED';
    }
    if (tsCol >= 0) await updateCell(APPROVE_BILLING_SHEET, rowNum, tsCol, new Date(timestamp).toISOString());
    if (statusCol >= 0) await updateCell(APPROVE_BILLING_SHEET, rowNum, statusCol, status || '');
    if (userCol >= 0) await updateCell(APPROVE_BILLING_SHEET, rowNum, userCol, userEmail || '');
    return 'OK';
  });
}
