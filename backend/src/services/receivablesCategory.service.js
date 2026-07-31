/**
 * Port of LMS.js lines 4249-4736 (Receivables "other order type" category
 * workflow): getReceivablesCategoryData, saveReceivableCategoryFollowUp,
 * saveReceivableCategoryPayment, normalizeMonth, getStatementPivotData,
 * getOutstandingPivotData.
 *
 * IMPORTANT: this operates on the "Receivables other order Type" sheet
 * (SHEETS.RECEIVABLE_CATEGORY) — a DIFFERENT sheet than the plain-Lease
 * Receivables workflow (SHEETS.RECEIVABLES, ported elsewhere into
 * receivables.service.js). The original keeps these as separate functions
 * and so does this port; a future cleanup could unify them.
 *
 * DATE HANDLING: googleSheets.service.js reads values with
 * dateTimeRenderOption 'FORMATTED_STRING', so date-typed sheet cells arrive
 * as locale-formatted strings, not JS Date objects. Every place the original
 * did `cell instanceof Date` is ported here as `parseDate(cell)` (truthy if
 * parseable) instead.
 */
import { getSheetData, updateRange, updateCell, getRange, colLetter, findColByHeader } from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, safeAmt, buildDisplayRow, parseDate, toNum } from '../utils/format.js';
import { checkActionPermission } from './permissions.service.js';
import { withSheetLock } from '../utils/sheetMutex.js';

const RECEIVABLE_CATEGORY_SHEET = SHEETS.RECEIVABLE_CATEGORY; // 'Receivables other order Type'
const RECEIVABLE_TYPE_MATCH = { Sale: 'sale', Accessories: ['spare', 'accessories'], Transportion: 'transport', AMC: 'amc', Other: null };

const COL_DEFS = {
  'receivable status': 'status', 'receivable timestamp': 'ts', 'receivable user': 'user',
  'total received': 'totalRecv', 'amount': 'amt',
  'billing date': 'billingDate', 'bill date': 'billingDate', 'invoice date': 'billingDate', 'actual': 'billingDate',
  'follow-up dates': 'followDate', 'follow-up remarks': 'followRemark', 'follow-up users': 'followUser',
  'payment date': 'payDate', 'payment attachment urls': 'payAttach',
  'payment log dates': 'payLogDate', 'payment log details': 'payLogDetail', 'payment log users': 'payLogUser',
  'dispute status': 'disputeStatus'
};

const NEEDED_COLS = [
  ['status', 'Receivable Status'], ['ts', 'Receivable Timestamp'], ['user', 'Receivable User'],
  ['totalRecv', 'Total Received'],
  ['followDate', 'Follow-up Dates'], ['followRemark', 'Follow-up Remarks'], ['followUser', 'Follow-up Users'],
  ['payDate', 'Payment Date'], ['payAttach', 'Payment Attachment URLs'],
  ['payLogDate', 'Payment Log Dates'], ['payLogDetail', 'Payment Log Details'], ['payLogUser', 'Payment Log Users'],
  ['disputeLogDates', 'Dispute Log Dates'], ['disputeLogDetails', 'Dispute Log Details'], ['disputeLogUser', 'Dispute Log User'], ['disputeLogAttach', 'Dispute Log Attachments']
];

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

/** Appends any missing header columns to `sheetName` starting at column `lastCol` (0-based). Returns the appended labels. */
async function ensureHeaders(sheetName, lastCol, toAppend) {
  if (toAppend.length > 0) {
    await updateRange(sheetName, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
  }
}

const MONTH_NUM_TO_NAME = {
  '1': 'Jan', '2': 'Feb', '3': 'Mar', '4': 'Apr', '5': 'May', '6': 'Jun',
  '7': 'Jul', '8': 'Aug', '9': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
};

export function normalizeMonth(val) {
  const s = String(val).trim();
  if (MONTH_NUM_TO_NAME[s]) return MONTH_NUM_TO_NAME[s];
  const m = s.substring(0, 3);
  const map = {
    jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
    jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec'
  };
  return map[m.toLowerCase()] || s;
}

export async function getReceivablesCategoryData(category, filterType) {
  let sheetData;
  try {
    sheetData = await getSheetData(RECEIVABLE_CATEGORY_SHEET);
  } catch (e) {
    return { headers: [], data: [], missing: true, sheetName: RECEIVABLE_CATEGORY_SHEET };
  }
  let { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [], totalAmount: 0, totalOutstanding: 0, totalReceived: 0, ageing: {} };

  let lastCol = lastColOf(headers, rows);
  const colMap = {};
  for (let h = 0; h < headers.length; h++) {
    const hdr = String(headers[h] || '').trim().toLowerCase();
    if (COL_DEFS[hdr]) colMap[COL_DEFS[hdr]] = h;
  }
  if (colMap.amt === undefined) colMap.amt = 9;
  if (colMap.billingDate === undefined) colMap.billingDate = 0;

  const toAppend = [];
  for (const [key, label] of NEEDED_COLS) {
    if (colMap[key] === undefined) { colMap[key] = lastCol + toAppend.length; toAppend.push(label); }
  }
  if (toAppend.length > 0) {
    await ensureHeaders(RECEIVABLE_CATEGORY_SHEET, lastCol, toAppend);
    headers = [...headers, ...toAppend];
    lastCol = headers.length;
  }

  const matchKey = RECEIVABLE_TYPE_MATCH[category];
  const finalData = [];
  let totalAmount = 0, totalOutstanding = 0, totalReceived = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const displayCount = Math.min(12, lastCol);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const billingDateParsed = parseDate(row[colMap.billingDate]);
    const hasDate = !!billingDateParsed;
    const hasAmt = typeof row[colMap.amt] === 'number' && row[colMap.amt] > 0;
    if (!hasDate && !hasAmt) continue;

    const rowType = String(row[3] || '').trim().toLowerCase();
    if (!matchesCategory(matchKey, rowType)) continue;

    const rowAmt = hasAmt ? row[colMap.amt] : 0;
    const rowRecvd = (colMap.totalRecv !== undefined && typeof row[colMap.totalRecv] === 'number') ? row[colMap.totalRecv] : 0;
    const outstanding = rowAmt - rowRecvd;
    totalAmount += rowAmt;

    /* Payment status detection — same logic as Lease */
    let isFullyPaid = false;
    if (colMap.status !== undefined) {
      const st = String(row[colMap.status] || '').trim().toLowerCase();
      if (st === 'paid') isFullyPaid = true;
    }
    if (colMap.payDate !== undefined && parseDate(row[colMap.payDate])) {
      isFullyPaid = true;
    }

    const hasPartialPayment = rowRecvd > 0;
    let include = false;
    if (filterType === 'pending') include = !isFullyPaid;
    else if (filterType === 'payment') include = isFullyPaid || hasPartialPayment;
    if (!include) continue;

    /* Aggregate based on filter */
    if (filterType === 'pending') {
      if (outstanding > 0) totalOutstanding += outstanding;
    } else {
      totalReceived += rowRecvd;
    }

    /* Ageing only for pending */
    let days = '', band = '';
    if (filterType === 'pending' && hasDate) {
      days = Math.ceil((today - billingDateParsed) / 86400000);
      if (days <= 30) band = '0-30';
      else if (days <= 60) band = '31-60';
      else if (days <= 90) band = '61-90';
      else band = '90+';
      if (outstanding > 0) ageing[band] += outstanding;
    }

    let rowOut;
    if (filterType === 'pending') {
      rowOut = buildDisplayRow(row, displayCount, headers);
      rowOut.push(safeAmt(rowRecvd));
    } else {
      rowOut = buildDisplayRow(row, displayCount, headers);
      rowOut.push(safeAmt(rowRecvd));
      rowOut.push(colMap.payDate !== undefined ? safeStr(row[colMap.payDate]) : '');
      rowOut.push(colMap.payLogDetail !== undefined ? safeStr(row[colMap.payLogDetail]) : '');
      rowOut.push(colMap.payLogDate !== undefined ? safeStr(row[colMap.payLogDate]) : '');
      rowOut.push(colMap.payLogUser !== undefined ? safeStr(row[colMap.payLogUser]) : '');
    }

    finalData.push({
      row: rowOut, _rowNum: i + 2, daysLeft: days, band,
      logV: colMap.followDate !== undefined ? safeStr(row[colMap.followDate]) : '',
      logW: colMap.followRemark !== undefined ? safeStr(row[colMap.followRemark]) : '',
      logX: colMap.followUser !== undefined ? safeStr(row[colMap.followUser]) : '',
      payLogAD: colMap.payAttach !== undefined ? safeStr(row[colMap.payAttach]) : '',
      payLogV: colMap.payLogDate !== undefined ? safeStr(row[colMap.payLogDate]) : '',
      payLogW: colMap.payLogDetail !== undefined ? safeStr(row[colMap.payLogDetail]) : '',
      payLogX: colMap.payLogUser !== undefined ? safeStr(row[colMap.payLogUser]) : '',
      disputeStatus: colMap.disputeStatus !== undefined ? safeStr(row[colMap.disputeStatus]) : '',
      disputeLogDates: colMap.disputeLogDates !== undefined ? safeStr(row[colMap.disputeLogDates]) : '',
      disputeLogDetails: colMap.disputeLogDetails !== undefined ? safeStr(row[colMap.disputeLogDetails]) : '',
      disputeLogUser: colMap.disputeLogUser !== undefined ? safeStr(row[colMap.disputeLogUser]) : '',
      disputeLogAttach: colMap.disputeLogAttach !== undefined ? safeStr(row[colMap.disputeLogAttach]) : ''
    });
  }

  const displayHeaders = [];
  for (let h = 0; h < displayCount; h++) displayHeaders.push(safeStr(headers[h]));
  if (filterType === 'pending') displayHeaders.push('Received Amount');
  else displayHeaders.push('Received Amount', 'Payment Date', 'UTR/Amount', 'Payment Log', 'Paid By');

  return { headers: displayHeaders, data: finalData, totalAmount, totalOutstanding, totalReceived, ageing };
}

/** callerEmail = authenticated user, used only for the permission check ('receivables'). */
export async function saveReceivableCategoryFollowUp(callerEmail, rowNum, timestamp, remarks, userEmail) {
  await checkActionPermission('receivables', callerEmail);
  if (!rowNum || isNaN(rowNum)) throw new Error('Invalid row reference');
  if (!remarks || String(remarks).trim() === '') throw new Error('Remarks are required');

  return withSheetLock(RECEIVABLE_CATEGORY_SHEET, async () => {
    const { headers } = await getSheetData(RECEIVABLE_CATEGORY_SHEET);
    let lastCol = headers.length;
    let fd = findColByHeader(headers, 'Follow-up Dates');
    let fr = findColByHeader(headers, 'Follow-up Remarks');
    let fu = findColByHeader(headers, 'Follow-up Users');

    const toAppend = [];
    if (fd === -1) { fd = lastCol + toAppend.length; toAppend.push('Follow-up Dates'); }
    if (fr === -1) { fr = lastCol + toAppend.length; toAppend.push('Follow-up Remarks'); }
    if (fu === -1) { fu = lastCol + toAppend.length; toAppend.push('Follow-up Users'); }
    await ensureHeaders(RECEIVABLE_CATEGORY_SHEET, lastCol, toAppend);

    const newTs = safeStr(new Date(timestamp));
    const fdV = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(fd)}${rowNum}:${colLetter(fd)}${rowNum}`))?.[0]?.[0];
    const frV = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(fr)}${rowNum}:${colLetter(fr)}${rowNum}`))?.[0]?.[0];
    const fuV = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(fu)}${rowNum}:${colLetter(fu)}${rowNum}`))?.[0]?.[0];

    if (fdV && String(fdV).trim() !== '') {
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fd, `${fdV}\n${newTs}`);
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fr, `${frV}\n${remarks}`);
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fu, `${fuV}\n${userEmail || ''}`);
    } else {
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fd, newTs);
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fr, remarks);
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, fu, userEmail || '');
    }
    return 'OK';
  });
}

/** callerEmail = authenticated user, used only for the permission check ('receivables'). */
export async function saveReceivableCategoryPayment(callerEmail, rowNum, timestamp, amount, utr, remarks, userEmail, attachmentUrl) {
  await checkActionPermission('receivables', callerEmail);
  if (!rowNum || isNaN(rowNum)) throw new Error('Invalid row reference');
  if (!utr || String(utr).trim() === '') throw new Error('UTR / Reference is required');
  const newPayment = parseFloat(amount);
  if (isNaN(newPayment) || newPayment <= 0) throw new Error('Payment amount is required and must be greater than zero');

  return withSheetLock(RECEIVABLE_CATEGORY_SHEET, async () => {
    const { headers } = await getSheetData(RECEIVABLE_CATEGORY_SHEET);
    let lastCol = headers.length;
    const cols = {};
    for (let h = 0; h < headers.length; h++) {
      const hdr = String(headers[h] || '').trim().toLowerCase();
      if (hdr === 'amount') cols.amt = h;
      else if (hdr === 'total received') cols.tr = h;
      else if (hdr === 'receivable status') cols.st = h;
      else if (hdr === 'receivable timestamp') cols.ts = h;
      else if (hdr === 'receivable user') cols.us = h;
      else if (hdr === 'payment date') cols.pd = h;
      else if (hdr === 'payment attachment urls') cols.pa = h;
      else if (hdr === 'payment log dates') cols.pld = h;
      else if (hdr === 'payment log details') cols.pldt = h;
      else if (hdr === 'payment log users') cols.plu = h;
    }
    if (cols.amt === undefined) cols.amt = 9;

    const toAppend = [];
    if (cols.tr === undefined) { cols.tr = lastCol + toAppend.length; toAppend.push('Total Received'); }
    if (cols.st === undefined) { cols.st = lastCol + toAppend.length; toAppend.push('Receivable Status'); }
    if (cols.ts === undefined) { cols.ts = lastCol + toAppend.length; toAppend.push('Receivable Timestamp'); }
    if (cols.us === undefined) { cols.us = lastCol + toAppend.length; toAppend.push('Receivable User'); }
    if (cols.pd === undefined) { cols.pd = lastCol + toAppend.length; toAppend.push('Payment Date'); }
    if (cols.pa === undefined) { cols.pa = lastCol + toAppend.length; toAppend.push('Payment Attachment URLs'); }
    if (cols.pld === undefined) { cols.pld = lastCol + toAppend.length; toAppend.push('Payment Log Dates'); }
    if (cols.pldt === undefined) { cols.pldt = lastCol + toAppend.length; toAppend.push('Payment Log Details'); }
    if (cols.plu === undefined) { cols.plu = lastCol + toAppend.length; toAppend.push('Payment Log Users'); }
    await ensureHeaders(RECEIVABLE_CATEGORY_SHEET, lastCol, toAppend);

    const trCell = cols.tr !== undefined ? (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.tr)}${rowNum}:${colLetter(cols.tr)}${rowNum}`))?.[0]?.[0] : undefined;
    const curRecv = typeof trCell === 'number' ? trCell : 0;
    const amtCell = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.amt)}${rowNum}:${colLetter(cols.amt)}${rowNum}`))?.[0]?.[0];
    const invAmt = typeof amtCell === 'number' ? amtCell : 0;

    const newTotal = curRecv + newPayment;
    if (invAmt > 0 && newTotal > invAmt) {
      throw new Error(`Payment exceeds outstanding of ₹${(invAmt - curRecv).toLocaleString('en-IN')}`);
    }

    if (cols.tr !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.tr, newTotal);

    const payDetail = `UTR: ${utr} | ₹${newPayment.toLocaleString('en-IN')}${remarks ? ` | ${remarks}` : ''}`;
    const payDate = safeStr(new Date(timestamp));

    if (cols.pld !== undefined) {
      const v = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.pld)}${rowNum}:${colLetter(cols.pld)}${rowNum}`))?.[0]?.[0];
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.pld, v && String(v).trim() ? `${v}\n${payDate}` : payDate);
    }
    if (cols.pldt !== undefined) {
      const v = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.pldt)}${rowNum}:${colLetter(cols.pldt)}${rowNum}`))?.[0]?.[0];
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.pldt, v && String(v).trim() ? `${v}\n${payDetail}` : payDetail);
    }
    if (cols.plu !== undefined) {
      const v = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.plu)}${rowNum}:${colLetter(cols.plu)}${rowNum}`))?.[0]?.[0];
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.plu, v && String(v).trim() ? `${v}\n${userEmail || ''}` : (userEmail || ''));
    }
    if (attachmentUrl && cols.pa !== undefined) {
      const vRaw = (await getRange(RECEIVABLE_CATEGORY_SHEET, `${colLetter(cols.pa)}${rowNum}:${colLetter(cols.pa)}${rowNum}`))?.[0]?.[0];
      const v = safeStr(vRaw);
      await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.pa, v.trim() ? `${v}\n${attachmentUrl}` : attachmentUrl);
    }

    if (newTotal >= invAmt && invAmt > 0) {
      if (cols.pd !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.pd, new Date(timestamp).toISOString());
      if (cols.st !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.st, 'Paid');
      if (cols.ts !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.ts, new Date(timestamp).toISOString());
      if (cols.us !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.us, userEmail || '');
      return 'FULL';
    } else {
      if (cols.st !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.st, 'Partial Payment');
      if (cols.ts !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.ts, new Date(timestamp).toISOString());
      if (cols.us !== undefined) await updateCell(RECEIVABLE_CATEGORY_SHEET, rowNum, cols.us, userEmail || '');
      return 'PARTIAL';
    }
  });
}

/* =============================================
   MONTHLY STATEMENT — PIVOT TABLE
   Container × Month → Billed / Received
============================================= */
export async function getStatementPivotData() {
  const { rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (!rows.length) return { months: [], containers: [], totalBilled: 0, totalReceived: 0, totalOutstanding: 0, collectionRate: 0 };

  const monthSet = {};
  const containerMap = {};

  for (const row of rows) {
    if (!row[0] || String(row[0]).trim() === '') continue;

    const container = String(row[0]).trim();
    const month = normalizeMonth(row[12]); // M(12) = Month
    const year = safeStr(row[13]);          // N(13) = Year
    const monthKey = `${month} ${year}`;

    if (!month || month === '' || year === '') continue;
    monthSet[monthKey] = true;

    if (!containerMap[container]) {
      containerMap[container] = { container, clientCode: safeStr(row[1]), clientName: safeStr(row[2]), months: {} };
    }
    if (!containerMap[container].months[monthKey]) containerMap[container].months[monthKey] = { billed: 0, received: 0 };

    const billed = typeof row[9] === 'number' ? row[9] : 0;   // J = Total Bill Amount
    const received = typeof row[28] === 'number' ? row[28] : 0; // AC = Received Amount

    containerMap[container].months[monthKey].billed += billed;
    containerMap[container].months[monthKey].received += received;
  }

  const monthOrder = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const months = Object.keys(monthSet).sort((a, b) => {
    const pA = a.split(' '), pB = b.split(' ');
    const yd = parseInt(pA[1], 10) - parseInt(pB[1], 10);
    return yd !== 0 ? yd : (monthOrder[pA[0]] || 0) - (monthOrder[pB[0]] || 0);
  });

  const containers = Object.values(containerMap);
  containers.sort((a, b) => a.container.localeCompare(b.container));

  let totalBilled = 0, totalReceived = 0;
  for (const c of containers) {
    for (const m of months) {
      const md = c.months[m] || { billed: 0, received: 0 };
      totalBilled += md.billed;
      totalReceived += md.received;
    }
  }

  return {
    months, containers, totalBilled, totalReceived,
    totalOutstanding: totalBilled - totalReceived,
    collectionRate: totalBilled > 0 ? Math.round((totalReceived / totalBilled) * 100) : 0
  };
}

/* =============================================
   OUTSTANDING VIEW — MONTH-WISE PIVOT
   Container × Month → Outstanding Amount
   With drill-down raw items for detail panel
============================================= */
export async function getOutstandingPivotData(viewBy) {
  const { headers, rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (!rows.length) return { months: [], data: [], totalOutstanding: 0, ageing: {} };

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Amount column — dynamic search
  let amtCol = -1;
  for (let h = 0; h < headers.length; h++) {
    if (String(headers[h] || '').toLowerCase().indexOf('amount') !== -1) { amtCol = h; break; }
  }
  if (amtCol === -1) amtCol = 9;

  const monthSet = {};
  const itemMap = {};
  let totalOutstanding = 0;
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

  for (const row of rows) {
    if (!row[0] || String(row[0]).trim() === '') continue;

    // Y(24) = Payment Receive — skip fully paid
    if (row[24] && String(row[24]).trim() !== '') continue;

    const amt = toNum(row[amtCol]);
    const recvd = toNum(row[28]);
    const outstanding = amt - recvd;
    if (outstanding <= 0) continue;

    const month = normalizeMonth(row[12]);
    const year = safeStr(row[13]);
    const monthKey = `${month} ${year}`;
    if (!month || month === '' || year === '') continue;
    monthSet[monthKey] = true;

    // O(14) = Actual (Billing Date) — ageing calculation
    let days = '', band = '';
    const bd = parseDate(row[14]);
    if (bd) {
      days = Math.ceil((today - bd) / 86400000);
      if (days <= 30) band = '0-30';
      else if (days <= 60) band = '31-60';
      else if (days <= 90) band = '61-90';
      else band = '90+';
      ageing[band] += outstanding;
    }

    const rawItem = {
      container: safeStr(row[0]), clientCode: safeStr(row[1]), clientName: safeStr(row[2]),
      monthKey, billed: amt, received: recvd, outstanding, days, band
    };

    if (viewBy === 'customer') {
      const clientCode = safeStr(row[1]);
      const clientName = safeStr(row[2]);
      /* Group by CLIENT NAME (aggregate amount correctly even if code is blank/different) */
      const key = (clientName || clientCode || safeStr(row[0])).toString().trim().toLowerCase();
      if (!itemMap[key]) {
        itemMap[key] = { label: clientName || clientCode || safeStr(row[0]), subLabel: clientCode, months: {}, rowTotal: 0, rawItems: [] };
      }
      if (!itemMap[key].subLabel && clientCode) itemMap[key].subLabel = clientCode;
      itemMap[key].months[monthKey] = (itemMap[key].months[monthKey] || 0) + outstanding;
      itemMap[key].rowTotal += outstanding;
      itemMap[key].rawItems.push(rawItem);
    } else {
      const container = safeStr(row[0]);
      if (!itemMap[container]) {
        itemMap[container] = { label: container, subLabel: safeStr(row[2]), months: {}, rowTotal: 0, rawItems: [] };
      }
      itemMap[container].months[monthKey] = (itemMap[container].months[monthKey] || 0) + outstanding;
      itemMap[container].rowTotal += outstanding;
      itemMap[container].rawItems.push(rawItem);
    }

    totalOutstanding += outstanding;
  }

  const monthOrder = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const months = Object.keys(monthSet).sort((a, b) => {
    const pA = a.split(' '), pB = b.split(' ');
    const yd = parseInt(pA[1], 10) - parseInt(pB[1], 10);
    return yd !== 0 ? yd : (monthOrder[pA[0]] || 0) - (monthOrder[pB[0]] || 0);
  });

  let keys = Object.keys(itemMap);
  if (viewBy === 'customer') keys.sort((a, b) => itemMap[a].label.localeCompare(itemMap[b].label));
  else keys.sort();

  const data = keys.map((k) => itemMap[k]);

  return { months, data, totalOutstanding, ageing };
}
