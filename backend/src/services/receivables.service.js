/**
 * Ported from LMS.js lines 2944-3527: getReceivablesLeaseData,
 * saveReceivableFollowUp, saveReceivableClientFollowUp,
 * saveReceivableLeasePayment, getPaymentLog, getStatementMonths,
 * getMonthlyStatementData, getOutstandingViewData,
 * getMonthlyBillingApprovalData, approveMonthlyBilling.
 *
 * Column layout preserved exactly from the original (0-based indices into
 * the row arrays read from the "Receivables" / "Billing Sales" sheets):
 *   Receivables: A=0 container, B=1 clientCode, C=2 clientName, F=5 size,
 *     G=6 type, H=7 billing days, I=8 billing range, J=9 total bill amount
 *     (default amount col), M=12 month, N=13 year, O=14 billing date
 *     (default billing-date col), R=17 status text, V=21/W=22/X=23
 *     follow-up log (date/detail/user), Y=24 payment-receive date,
 *     AC=28 received amount, AD=29 payment attachment, AE=30/AF=31/AG=32
 *     payment log (date/detail/user), AH=33 dispute status, AI=34 dispute
 *     type, AN=39/AO=40/AP=41/AQ=42 dispute log (date/detail/user/attach).
 *   Billing Sales: A=0 container, B=1 clientCode, C=2 clientName, D=3 size,
 *     E=4 type, F=5 location, I=8 rate, J=9 cycle, K=10 month, L=11 year,
 *     M=12 amount, X=23 approval marker, Y=24 approved date, Z=25 approver.
 *
 * NOTE on dates: googleSheets.service.js's getSheetData() reads with
 * dateTimeRenderOption: 'FORMATTED_STRING', so date-formatted cells arrive
 * as strings, never as native JS Date instances (unlike Apps Script's
 * getValues(), which returns real Date objects). Where the original
 * branched on `instanceof Date` to decide whether a billing date was usable
 * (getOutstandingViewData), this port instead parses the cell through
 * parseDate() and checks for a non-null result — same intent, adapted to
 * the string transport. getReceivablesLeaseData's billing-date resolution
 * already had a parseDate() fallback branch in the original, so no
 * behavioral adaptation was needed there.
 */
import { getSheetData, updateCell } from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, safeAmt, parseDate, buildDisplayRow } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { AppError } from '../utils/AppError.js';

/* ===== month helpers (ported from LMS.js normalizeMonth / MONTH_NUM_TO_NAME / _normKey) ===== */
const MONTH_NUM_TO_NAME = {
  '1': 'Jan', '2': 'Feb', '3': 'Mar', '4': 'Apr', '5': 'May', '6': 'Jun',
  '7': 'Jul', '8': 'Aug', '9': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
};
const MONTH_ABBR = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec'
};
const MONTH_ORDER = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function normalizeMonth(val) {
  const s = String(val).trim();
  if (MONTH_NUM_TO_NAME[s]) return MONTH_NUM_TO_NAME[s];
  const m = s.substring(0, 3).toLowerCase();
  return MONTH_ABBR[m] || s;
}

function normKey(s) {
  return (s == null ? '' : s).toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Shared "find the Amount column dynamically" logic — used identically by
   getReceivablesLeaseData and saveReceivableLeasePayment in the original
   (inline, duplicated); factored here without changing the search order. */
function findAmountCol(headers33) {
  for (let h = 0; h < headers33.length; h++) {
    if (String(headers33[h] || '').toLowerCase().indexOf('amount') !== -1) return h;
  }
  return 9;
}

export async function getReceivablesLeaseData(filterType) {
  const { headers: fullHeaders, rows: allRows } = await getSheetData(SHEETS.RECEIVABLES);
  if (allRows.length === 0) {
    return { headers: [], data: [], clients: [], total: 0, ageing: {}, totalReceived: 0 };
  }

  // Original reads headers as A1:AG1 (33 cols) — mirror that width so
  // column-detection loops below scan exactly the same header set.
  const allHeaders = fullHeaders.slice(0, 33);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let totalReceivable = 0, totalReceived = 0;
  const finalData = [];
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

  const amtCol = findAmountCol(allHeaders);

  let billingDateCol = -1;
  for (let h = 0; h < allHeaders.length; h++) {
    const hdr = String(allHeaders[h] || '').toLowerCase().trim();
    if (hdr === 'actual' || hdr === 'billing date' || hdr === 'invoice date' ||
      (hdr.indexOf('bill') !== -1 && hdr.indexOf('date') !== -1) ||
      (hdr.indexOf('invoice') !== -1 && hdr.indexOf('date') !== -1)) {
      billingDateCol = h; break;
    }
  }
  if (billingDateCol === -1) billingDateCol = 14;

  let invoiceCol = -1;
  for (let h = 0; h < allHeaders.length; h++) {
    const ihdr = String(allHeaders[h] || '').toLowerCase().trim();
    if (ihdr === 'invoice no' || ihdr === 'invoice number' || ihdr === 'invoice' || ihdr === 'invoice no.') {
      invoiceCol = h; break;
    }
  }

  const pickPending = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 28];
  const pickPayment = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15];
  if (invoiceCol !== -1 && pickPending.indexOf(invoiceCol) === -1) pickPending.push(invoiceCol);
  let displayHeaders = pickPending.map((ci) => safeStr(allHeaders[ci]));

  /* Duplicate guard (display side) — same container + month + year appearing
     twice in the sheet would otherwise double-count outstanding. Keep first
     occurrence only. */
  const seenRecv = {};

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row[0] || row[0].toString().trim() === '') continue;

    const rk = normKey(row[0]) + '|' + normalizeMonth(row[12]) + '|' + safeStr(row[13]);
    if (seenRecv[rk]) continue;
    seenRecv[rk] = true;

    const rawAmt = typeof row[amtCol] === 'number' ? row[amtCol] : 0;
    const amt = Math.ceil(rawAmt * 1.18);
    const recvd = typeof row[28] === 'number' ? row[28] : 0;
    const hasPaymentY = !!(row[24] && row[24].toString().trim() !== '');
    const hasPaymentR = !!(row[17] && row[17].toString().trim().toLowerCase().indexOf('payment') !== -1);
    const isFullyPaid = hasPaymentY;
    const isPaid = hasPaymentY || hasPaymentR;

    const rawVal = row[billingDateCol];
    let billingDate = null;
    if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
      billingDate = rawVal;
    } else if (typeof rawVal === 'number' && rawVal > 25000 && rawVal < 60000) {
      billingDate = new Date(Math.round((rawVal - 25569) * 86400000));
    } else {
      billingDate = parseDate(rawVal);
    }

    let days = '', band = '', outstanding = 0;
    if (!isFullyPaid && billingDate) {
      days = Math.ceil((today - billingDate) / (1000 * 60 * 60 * 24));
      outstanding = amt - recvd;
      if (outstanding > 0) {
        if (days <= 30) { band = '0-30'; ageing['0-30'] += outstanding; }
        else if (days <= 60) { band = '31-60'; ageing['31-60'] += outstanding; }
        else if (days <= 90) { band = '61-90'; ageing['61-90'] += outstanding; }
        else { band = '90+'; ageing['90+'] += outstanding; }
      }
    } else {
      outstanding = amt - recvd;
    }

    let include = false;
    if (filterType === 'pending') include = !isFullyPaid;
    else if (filterType === 'payment') include = isPaid;
    if (!include) continue;

    if (filterType === 'pending') totalReceivable += Math.max(0, outstanding);
    else totalReceived += recvd;

    let displayRow;
    if (filterType === 'pending') {
      displayRow = buildDisplayRow(row, pickPending, allHeaders);
    } else {
      displayRow = buildDisplayRow(row, pickPayment, allHeaders);
      displayRow.push(safeAmt(row[28]));
      displayRow.push(safeStr(row[24]));
      displayRow.push(safeStr(row[31]));
      displayRow.push(safeStr(row[30]));
      displayRow.push(safeStr(row[32]));
    }

    finalData.push({
      row: displayRow,
      _rowNum: i + 2,
      _idx: finalData.length,
      daysLeft: days,
      band,
      amount: amt,
      received: recvd,
      outstanding: Math.max(0, outstanding),
      clientCode: safeStr(row[1]),
      clientName: safeStr(row[2]),
      invoiceNo: invoiceCol !== -1 ? safeStr(row[invoiceCol]) : '',
      logV: safeStr(row[21]),
      logW: safeStr(row[22]),
      logX: safeStr(row[23]),
      payLogAD: safeStr(row[29]),
      payLogV: safeStr(row[30]),
      payLogW: safeStr(row[31]),
      payLogX: safeStr(row[32]),
      disputeStatus: safeStr(row[33]),
      disputeType: safeStr(row[34]),
      disputeLogDates: safeStr(row[39]),
      disputeLogDetails: safeStr(row[40]),
      disputeLogUser: safeStr(row[41]),
      disputeLogAttach: safeStr(row[42])
    });
  }

  if (filterType === 'payment') {
    displayHeaders = allHeaders.slice(0, 12).map((h) => safeStr(h));
    displayHeaders.push('Received Amount', 'Payment Date', 'UTR/Amount', 'Payment Log', 'Paid By');
  }

  /* Billing invoice map (best-effort, matches original's empty catch) */
  const billingMap = {};
  try {
    const { rows: bRows } = await getSheetData(SHEETS.BILLING_SALES);
    for (const brow of bRows) {
      const bc = brow[0] ? brow[0].toString().trim() : '';
      const bInv = brow[30] ? brow[30].toString().trim() : '';
      const bAtt = brow[28] ? brow[28].toString().trim() : '';
      if (bc && bInv) billingMap[bc] = { invoice: bInv, attachment: bAtt };
    }
  } catch (e) { /* best-effort, matches original */ }

  for (const item of finalData) {
    item.billingInfo = billingMap[item.row[0]] || null;
  }

  /* Client-wise grouping */
  const clientMap = {};
  finalData.forEach((item, j) => {
    const cc = item.clientCode || ('_unknown_' + j);
    if (!clientMap[cc]) {
      clientMap[cc] = {
        clientCode: cc, clientName: item.clientName, containers: [],
        totalOutstanding: 0, totalReceived: 0, containerCount: 0
      };
    }
    clientMap[cc].containers.push(item);
    clientMap[cc].containerCount++;
    if (item.billingInfo && item.billingInfo.invoice) {
      if (!clientMap[cc].invoiceMap) clientMap[cc].invoiceMap = {};
      clientMap[cc].invoiceMap[item.billingInfo.invoice] = item.billingInfo;
    }
    if (filterType === 'pending') clientMap[cc].totalOutstanding += item.outstanding;
    else clientMap[cc].totalReceived += item.received;
  });
  const clients = Object.values(clientMap).sort((a, b) => a.clientName.localeCompare(b.clientName));

  const invoiceMap = {};
  finalData.forEach((item) => {
    const inv = item.invoiceNo || '';
    const key = inv || '_no_inv_';
    if (!invoiceMap[key]) {
      invoiceMap[key] = {
        invoiceNo: inv, clientCode: item.clientCode, clientName: item.clientName,
        containers: [], totalOutstanding: 0, totalReceived: 0, containerCount: 0
      };
    }
    invoiceMap[key].containers.push(item);
    invoiceMap[key].containerCount++;
    if (filterType === 'pending') invoiceMap[key].totalOutstanding += item.outstanding;
    else invoiceMap[key].totalReceived += item.received;
  });
  const invoices = Object.values(invoiceMap).sort((a, b) => {
    if (a.invoiceNo === '') return 1;
    if (b.invoiceNo === '') return -1;
    return a.invoiceNo.localeCompare(b.invoiceNo);
  });

  return {
    headers: displayHeaders,
    data: finalData,
    clients,
    total: totalReceivable,
    ageing,
    invoices,
    totalReceived
  };
}

export async function saveReceivableFollowUp(containerNo, timestamp, remarks, userEmail) {
  if (!containerNo || containerNo.toString().trim() === '') throw new AppError('Container number is required');
  if (!remarks || remarks.toString().trim() === '') throw new AppError('Remarks are required');

  return withSheetLock(SHEETS.RECEIVABLES, async () => {
    const { rows } = await getSheetData(SHEETS.RECEIVABLES);
    if (rows.length === 0) throw new AppError('No data rows');
    let targetIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] == containerNo) { targetIdx = i; break; }
    }
    if (targetIdx === -1) throw new AppError('Not found: ' + containerNo);
    const targetRow = targetIdx + 2;
    const row = rows[targetIdx];
    const vVal = row[21], wVal = row[22], xVal = row[23];
    const newTs = safeStr(new Date(timestamp));

    if (vVal && vVal.toString().trim() !== '') {
      await updateCell(SHEETS.RECEIVABLES, targetRow, 21, vVal + '\n' + newTs);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 22, wVal + '\n' + (remarks || ''));
      await updateCell(SHEETS.RECEIVABLES, targetRow, 23, xVal + '\n' + (userEmail || ''));
    } else {
      await updateCell(SHEETS.RECEIVABLES, targetRow, 21, newTs);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 22, remarks || '');
      await updateCell(SHEETS.RECEIVABLES, targetRow, 23, userEmail || '');
    }
    return 'OK';
  });
}

export async function saveReceivableClientFollowUp(clientCode, timestamp, remarks, userEmail) {
  if (!clientCode || clientCode.toString().trim() === '') throw new AppError('Client code is required');
  if (!remarks || remarks.toString().trim() === '') throw new AppError('Remarks are required');

  return withSheetLock(SHEETS.RECEIVABLES, async () => {
    const { rows } = await getSheetData(SHEETS.RECEIVABLES);
    if (rows.length === 0) throw new AppError('No data rows');
    const newTs = safeStr(new Date(timestamp));
    let updatedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || row[0].toString().trim() === '') continue;
      if ((row[1] == null ? '' : row[1]).toString().trim() !== clientCode.toString().trim()) continue;

      const rn = i + 2;
      const vVal = row[21], wVal = row[22], xVal = row[23];
      if (vVal && vVal.toString().trim() !== '') {
        await updateCell(SHEETS.RECEIVABLES, rn, 21, vVal + '\n' + newTs);
        await updateCell(SHEETS.RECEIVABLES, rn, 22, wVal + '\n' + (remarks || ''));
        await updateCell(SHEETS.RECEIVABLES, rn, 23, xVal + '\n' + (userEmail || ''));
      } else {
        await updateCell(SHEETS.RECEIVABLES, rn, 21, newTs);
        await updateCell(SHEETS.RECEIVABLES, rn, 22, remarks || '');
        await updateCell(SHEETS.RECEIVABLES, rn, 23, userEmail || '');
      }
      updatedCount++;
    }
    if (updatedCount === 0) throw new AppError('No containers found for client: ' + clientCode);
    return 'OK:' + updatedCount;
  });
}

export async function saveReceivableLeasePayment(containerNo, timestamp, amount, utr, remarks, userEmail, attachmentUrl) {
  if (!containerNo || containerNo.toString().trim() === '') throw new AppError('Container number is required');
  if (!utr || utr.toString().trim() === '') throw new AppError('UTR / Reference is required');
  const newPayment = parseFloat(amount);
  if (isNaN(newPayment) || newPayment <= 0) throw new AppError('Payment amount is required and must be greater than zero');

  return withSheetLock(SHEETS.RECEIVABLES, async () => {
    const { headers: fullHeaders, rows } = await getSheetData(SHEETS.RECEIVABLES);
    if (rows.length === 0) throw new AppError('No data rows');
    let targetIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] == containerNo) { targetIdx = i; break; }
    }
    if (targetIdx === -1) throw new AppError('Not found: ' + containerNo);
    const targetRow = targetIdx + 2;
    const row = rows[targetIdx];

    const currentReceived = typeof row[28] === 'number' ? row[28] : 0;

    // Find Amount column dynamically — handles "Total Bill Amount" or any variant
    const amtCol = findAmountCol(fullHeaders.slice(0, 33));
    const invoiceAmount = typeof row[amtCol] === 'number' ? row[amtCol] : 0;

    const newTotal = currentReceived + newPayment;
    if (invoiceAmount > 0 && newTotal > invoiceAmount) {
      throw new AppError(
        'Payment ₹' + newPayment.toLocaleString('en-IN') +
        ' would exceed outstanding of ₹' + (invoiceAmount - currentReceived).toLocaleString('en-IN')
      );
    }

    await updateCell(SHEETS.RECEIVABLES, targetRow, 28, newTotal);
    const payDetail = 'UTR: ' + utr + ' | ₹' + newPayment.toLocaleString('en-IN') + (remarks ? ' | ' + remarks : '');
    const payDate = safeStr(new Date(timestamp));
    const aeVal = row[30], afVal = row[31], agVal = row[32];

    if (aeVal && aeVal.toString().trim() !== '') {
      await updateCell(SHEETS.RECEIVABLES, targetRow, 30, aeVal + '\n' + payDate);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 31, afVal + '\n' + payDetail);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 32, agVal + '\n' + (userEmail || ''));
    } else {
      await updateCell(SHEETS.RECEIVABLES, targetRow, 30, payDate);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 31, payDetail);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 32, userEmail || '');
    }

    if (attachmentUrl) {
      const adVal = safeStr(row[29]);
      await updateCell(SHEETS.RECEIVABLES, targetRow, 29, adVal.trim() !== '' ? adVal + '\n' + attachmentUrl : attachmentUrl);
    }

    if (newTotal >= invoiceAmount && invoiceAmount > 0) {
      // Written as dd/MM/yyyy text (same formatting safeStr() uses for every
      // other date column in this sheet) so Sheets' USER_ENTERED parsing
      // recognizes it as a date the same way the original's native
      // setValue(new Date(...)) did.
      await updateCell(SHEETS.RECEIVABLES, targetRow, 24, safeStr(new Date(timestamp)));
      await updateCell(SHEETS.RECEIVABLES, targetRow, 17, 'Payment Received');
      return 'FULL';
    } else {
      await updateCell(SHEETS.RECEIVABLES, targetRow, 17, 'Partial Payment');
      return 'PARTIAL';
    }
  });
}

export async function getPaymentLog(containerNo) {
  const { rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (rows.length === 0) return { logs: [], totalReceived: 0 };
  let targetIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] == containerNo) { targetIdx = i; break; }
  }
  if (targetIdx === -1) return { logs: [], totalReceived: 0 };

  const row = rows[targetIdx];
  const totalReceived = typeof row[28] === 'number' ? row[28] : 0;
  const ae = safeStr(row[30]);
  const af = safeStr(row[31]);
  const ag = safeStr(row[32]);
  const dates = ae.split('\n').filter((x) => x.trim() !== '');
  const details = af.split('\n').filter((x) => x.trim() !== '');
  const users = ag.split('\n').filter((x) => x.trim() !== '');
  const logs = [];
  for (let j = 0; j < dates.length; j++) {
    logs.push({ date: dates[j] || '-', detail: details[j] || '-', user: users[j] || '-' });
  }
  return { logs, totalReceived };
}

export async function getStatementMonths() {
  const { rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (rows.length === 0) return { months: [] };

  const seen = {};
  const months = [];
  for (const row of rows) {
    const m = normalizeMonth(row[12]);
    const y = safeStr(row[13]);
    if (m === '' || y === '') continue;
    const key = m + '|' + y;
    if (!seen[key]) { seen[key] = true; months.push({ month: m, year: y }); }
  }
  months.sort((a, b) => {
    const yd = parseInt(a.year, 10) - parseInt(b.year, 10);
    return yd !== 0 ? yd : (MONTH_ORDER[a.month] || 0) - (MONTH_ORDER[b.month] || 0);
  });
  return { months };
}

export async function getMonthlyStatementData(month, year, viewBy) {
  const { rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (rows.length === 0) return { data: [], totalAmount: 0 };

  const filtered = [];
  for (const row of rows) {
    if (!row[0] || row[0].toString().trim() === '') continue;
    if (normalizeMonth(row[12]) !== month || safeStr(row[13]) !== year) continue;

    filtered.push({
      container: safeStr(row[0]),
      clientCode: safeStr(row[1]),
      clientName: safeStr(row[2]),
      size: safeStr(row[5]),
      type: safeStr(row[6]),
      location: safeStr(row[8]),
      deployedDate: safeStr(row[8]),
      validUpto: safeStr(row[8]),
      rate: safeStr(row[7]),
      cycle: safeStr(row[7]),
      amount: typeof row[9] === 'number' ? row[9] : 0
    });
  }

  let totalAmount = 0;
  for (const f of filtered) totalAmount += f.amount;

  if (viewBy === 'customer') {
    const custMap = {};
    for (const f of filtered) {
      const key = f.clientCode;
      if (!custMap[key]) {
        custMap[key] = { clientCode: f.clientCode, clientName: f.clientName, containers: [], totalAmount: 0, totalOutstanding: 0 };
      }
      custMap[key].containers.push(f);
      custMap[key].totalAmount += f.amount;
      custMap[key].totalOutstanding += f.amount;
    }
    return { data: Object.values(custMap), totalAmount };
  }
  return { data: filtered, totalAmount };
}

export async function getOutstandingViewData(month, year, viewBy) {
  const { rows } = await getSheetData(SHEETS.RECEIVABLES);
  if (rows.length === 0) return { data: [], totalOutstanding: 0 };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const filtered = [];
  let totalOutstanding = 0;

  for (const row of rows) {
    if (!row[0] || row[0].toString().trim() === '') continue;
    if (normalizeMonth(row[12]) !== month || safeStr(row[13]) !== year) continue;
    if (row[24] && row[24].toString().trim() !== '') continue; // Y = Payment Receive -> skip if paid

    const amt = typeof row[9] === 'number' ? row[9] : 0;      // J = Total Bill Amount
    const recvd = typeof row[28] === 'number' ? row[28] : 0;  // AC = Received Amount
    const outstanding = amt - recvd;
    if (outstanding <= 0) continue;

    // O(14) = Actual (Billing Date). See file-level note: transport returns a
    // formatted string here, not a Date, so parse it rather than instanceof-check.
    const billingDateParsed = parseDate(row[14]);
    let days = '', band = '';
    if (billingDateParsed) {
      days = Math.ceil((today - billingDateParsed) / (1000 * 60 * 60 * 24));
      if (days <= 30) band = '0-30';
      else if (days <= 60) band = '31-60';
      else if (days <= 90) band = '61-90';
      else band = '90+';
    }

    filtered.push({
      container: safeStr(row[0]),
      clientCode: safeStr(row[1]),
      clientName: safeStr(row[2]),
      billedDate: safeStr(row[14]),
      amount: amt,
      received: recvd,
      outstanding,
      days,
      band
    });
    totalOutstanding += outstanding;
  }

  if (viewBy === 'customer') {
    const custMap = {};
    for (const f of filtered) {
      const key = f.clientCode;
      if (!custMap[key]) {
        custMap[key] = { clientCode: f.clientCode, clientName: f.clientName, containers: [], totalOutstanding: 0, containerCount: 0 };
      }
      custMap[key].containers.push(f);
      custMap[key].totalOutstanding += f.outstanding;
      custMap[key].containerCount++;
    }
    return { data: Object.values(custMap), totalOutstanding };
  }
  return { data: filtered, totalOutstanding };
}

export async function getMonthlyBillingApprovalData(month, year) {
  const { rows } = await getSheetData(SHEETS.BILLING_SALES);
  if (rows.length === 0) return { data: [], totalContainers: 0, totalAmount: 0, totalPending: 0 };

  const filtered = [];
  let totalAmount = 0, totalPending = 0;
  for (const row of rows) {
    if (!row[0] || row[0].toString().trim() === '') continue;
    if (safeStr(row[10]) !== month || safeStr(row[11]) !== year) continue;

    const amt = typeof row[12] === 'number' ? row[12] : 0;
    const xVal = row[23];
    const status = (xVal && xVal.toString().trim() !== '') ? 'Approved' : 'Pending';
    filtered.push({
      container: safeStr(row[0]), clientCode: safeStr(row[1]), clientName: safeStr(row[2]),
      size: safeStr(row[3]), type: safeStr(row[4]), location: safeStr(row[5]),
      rate: safeStr(row[8]), cycle: safeStr(row[9]), amount: amt, status
    });
    totalAmount += amt;
    if (status === 'Pending') totalPending++;
  }

  const custMap = {};
  for (const f of filtered) {
    const key = f.clientCode;
    if (!custMap[key]) custMap[key] = { clientCode: f.clientCode, clientName: f.clientName, containers: [], totalAmount: 0, pendingCount: 0 };
    custMap[key].containers.push(f);
    custMap[key].totalAmount += f.amount;
    if (f.status === 'Pending') custMap[key].pendingCount++;
  }

  return { data: Object.values(custMap), totalContainers: filtered.length, totalAmount, totalPending };
}

/**
 * `approverEmail` replaces the original's implicit `getCurrentUser(arguments[last])`
 * (the token-derived current user) — callers pass the authenticated req.user.email.
 */
export async function approveMonthlyBilling(containerNo, month, year, clientCode, approverEmail) {
  if (!month || !year) throw new AppError('Month and year are required');
  if (!containerNo && !clientCode) throw new AppError('Container or client code required');

  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const { rows } = await getSheetData(SHEETS.BILLING_SALES);
    if (rows.length === 0) throw new AppError('No data rows');

    let approved = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || row[0].toString().trim() === '') continue;
      if (safeStr(row[10]) !== month || safeStr(row[11]) !== year) continue;

      let isMatch = false;
      if (containerNo && row[0].toString() === containerNo) isMatch = true;
      if (!isMatch && clientCode && row[1] != null && row[1].toString() === clientCode) isMatch = true;
      if (!isMatch) continue;

      if (row[23] && row[23].toString().trim() !== '') {
        if (containerNo) return 'ALREADY_PROCESSED';
        continue;
      }

      const rowNum = i + 2;
      await updateCell(SHEETS.BILLING_SALES, rowNum, 23, 'Approved');
      await updateCell(SHEETS.BILLING_SALES, rowNum, 24, safeStr(new Date()));
      await updateCell(SHEETS.BILLING_SALES, rowNum, 25, approverEmail || '');
      approved++;
    }
    if (approved === 0) throw new AppError('No pending records found to approve');
    return 'Approved ' + approved + ' record(s)';
  });
}
