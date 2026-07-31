/**
 * Port of LMS.js lines 4926-5469 (the "Transportation" workflow, all sharing
 * the single "Transportion" sheet tab — SHEETS.TRANSPORTION — note the
 * original's spelling, "Transportion" not "Transportation", the live tab is
 * named exactly that):
 *
 *   getApproveTransportData / saveApproveTransportAction   (LMS.js 4932-5017)
 *   getBillingTransportData / saveBillingTransportAction    (LMS.js 5027-5121)
 *   getReceivablesTransportData / saveReceivableTransportFollowUp /
 *     saveReceivableTransportPayment                        (LMS.js 5141-5374)
 *   _ensureTransportHeaders                                 (LMS.js 5376-5395)
 *   saveBulkBillingAction                                   (LMS.js 5397-5469)
 *
 * Column layout (A:Q = 17 data columns, row 1 = header; everything from column
 * 26 onward is workflow bookkeeping the original appends on demand). 1-based
 * Apps Script column numbers from the original, converted to 0-based row
 * indices used throughout this file:
 *   Z(26)=25  Approve Status        AA(27)=26 Approve Timestamp   AB(28)=27 Approve User
 *   AC(29)=28 Billing Timestamp     AD(30)=29 Billing Attachment  AE(31)=30 Billing User
 *   AF(32)=31 Invoice No            AG(33)=32 Receivable Status   AH(34)=33 Receivable Timestamp
 *   AI(35)=34 Receivable User       AJ(36)=35 Total Received      AK(37)=36 Follow-up Dates
 *   AL(38)=37 Follow-up Remarks     AM(39)=38 Follow-up Users     AN(40)=39 Payment Date
 *   AO(41)=40 Payment Attachment URLs   AP(42)=41 Payment Log Dates
 *   AQ(43)=42 Payment Log Details       AR(44)=43 Payment Log Users
 *
 * ★ PRESERVED QUIRK: _ensureTransportHeaders' colNames map only labels up to
 * 1-based column 45 ("Dispute Status"), leaving column 46 (0-based 45, i.e.
 * spreadsheet column AT) blank/unlabeled — yet getReceivablesTransportData
 * actually READS the dispute-status flag from column 46, not 45. This is a
 * pre-existing off-by-one in the original (LMS.js `_sl(46)` vs. `colNames[45]`)
 * and is preserved exactly here, not "fixed" — see the dispute-status read
 * below (row[45]).
 *
 * DEVIATION — timestamp write formats: the original writes these via Apps
 * Script's native `setValue(new Date(...))`, producing a genuine date-typed
 * cell (later read back with `instanceof Date`). The Sheets REST API only
 * accepts strings/numbers in a JSON body, so every sibling service in this
 * migration (approve.service.js, billing.service.js, receivables.service.js)
 * already picks its own text encoding for this same problem. This file:
 *   - Approve Timestamp (AA) / Billing Timestamp (AC): `.toISOString()`,
 *     matching approveCategory.service.js / billing.service.js's convention
 *     for the same semantic field — chosen here because approvalSummary
 *     .service.js needs to parse these back for its "Approved Date" ISO
 *     output, and ISO strings round-trip through JS `Date` parsing exactly.
 *   - Follow-up timestamp (AK): `safeStr(new Date(timestamp))` — this one
 *     is not a deviation at all, the ORIGINAL LMS.js code for this exact
 *     field already calls `safeStr(new Date(timestamp))` (line 5286), not a
 *     raw Date.
 *   - Receivable Timestamp (AH) / Payment Date (AN) / Payment Log Date (AP):
 *     `safeStr(new Date(timestamp))` (date-only, no time-of-day), matching
 *     receivables.service.js's saveReceivableLeasePayment treatment of the
 *     exact same semantic fields on the plain-Lease "Receivables" sheet.
 *
 * PERMISSION CHECKS: the original calls `checkActionPermission('approve'|
 * 'billing'|'receivables', arguments[arguments.length-1])` inline in every
 * mutating function here. Matching the convention already used by this
 * migration's approve.service.js / receivables.service.js (rather than
 * billing.service.js's alternate convention of an extra `callerEmail` param
 * checked inside the service), permission is enforced once at the route
 * layer via `requirePermission(...)` middleware (see transport.routes.js) —
 * functionally equivalent, and avoids bolting an extra parameter onto every
 * signature here that the original didn't have.
 */
import {
  getSheetData,
  getRange,
  updateRange,
  updateCell,
  colLetter
} from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, safeAmt, parseDate, buildDisplayRow, usefulCols } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { AppError } from '../utils/AppError.js';

/* ===== local helpers ===== */

function padWidth(arr, width) {
  const out = (arr || []).slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

/** Approximates Apps Script's sheet.getLastColumn(): the widest row (headers
 *  or any data row) seen in a getSheetData() read. Same technique already
 *  used by approveCategory.service.js for this exact REST-API limitation
 *  (there is no direct getLastColumn() equivalent over the Sheets API — a
 *  column that once had content but is now fully cleared won't be counted,
 *  unlike Apps Script's real getLastColumn()). */
function _lastColOf(headers, rows) {
  let n = headers.length;
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

/** Column-name map shared by _ensureTransportHeaders (cols 26-46, 1-based). */
const TRANSPORT_COL_NAMES = {
  26: 'Approve Status', 27: 'Approve Timestamp', 28: 'Approve User',
  29: 'Billing Timestamp', 30: 'Billing Attachment', 31: 'Billing User', 32: 'Invoice No',
  33: 'Receivable Status', 34: 'Receivable Timestamp', 35: 'Receivable User',
  36: 'Total Received',
  37: 'Follow-up Dates', 38: 'Follow-up Remarks', 39: 'Follow-up Users',
  40: 'Payment Date', 41: 'Payment Attachment URLs',
  42: 'Payment Log Dates', 43: 'Payment Log Details', 44: 'Payment Log Users',
  45: 'Dispute Status' // ★ see file header: col 46 (not 45) is what's actually read as dispute status
};

/**
 * Auto-creates any missing header cells from 1-based column 26 through 46
 * on the Transportion sheet. Ported verbatim (including the column-45/46
 * quirk noted in the file header) from LMS.js `_ensureTransportHeaders`
 * (5376-5395), which took a `sheet` object; here it always targets
 * SHEETS.TRANSPORTION since that was the only sheet ever passed to it.
 */
export async function _ensureTransportHeaders() {
  const { headers, rows } = await getSheetData(SHEETS.TRANSPORTION);
  const lastCol = _lastColOf(headers, rows); // count = highest 1-based col index used
  if (lastCol < 46) {
    const toAppend = [];
    for (let c = lastCol + 1; c <= 46; c++) toAppend.push(TRANSPORT_COL_NAMES[c] || '');
    if (toAppend.length > 0) {
      await updateRange(
        SHEETS.TRANSPORTION,
        `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`,
        [toAppend]
      );
    }
  }
}

/* =============================================
   APPROVE — TRANSPORTATION   LMS.js 4932-5017
============================================= */
export async function getApproveTransportData() {
  let sheetData;
  try {
    sheetData = await getSheetData(SHEETS.TRANSPORTION);
  } catch (e) {
    return { headers: [], data: [], missing: true, sheetName: SHEETS.TRANSPORTION };
  }
  const { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [] };

  const headers17 = padWidth(headers, 17);
  const allRows = rows.map((r) => padWidth(r, 17));

  /* Auto-create Z, AA, AB headers if missing (cols 26-28 only — this
     function's own inline check, NOT the full _ensureTransportHeaders). */
  const lastCol = _lastColOf(headers, rows);
  if (lastCol < 28) {
    const toAppend = [];
    for (let c = lastCol + 1; c <= 28; c++) {
      if (c === 26) toAppend.push('Approve Status');
      else if (c === 27) toAppend.push('Approve Timestamp');
      else if (c === 28) toAppend.push('Approve User');
      else toAppend.push('');
    }
    if (toAppend.length > 0) {
      await updateRange(SHEETS.TRANSPORTION, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    }
  }

  /* ★ Drop blank columns so the table does not render a wall of empty cells */
  const pick = usefulCols(headers17, allRows, 17);

  const finalData = [];
  for (let i = 0; i < allRows.length; i++) {
    if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
    const approveStatus = rows[i][25]; // Z
    if (approveStatus && String(approveStatus).trim().toLowerCase() === 'approved') continue;
    finalData.push({ row: buildDisplayRow(allRows[i], pick, headers17), _rowNum: i + 2 });
  }

  return {
    headers: pick.map((ci) => safeStr(headers17[ci])),
    data: finalData
  };
}

export async function saveApproveTransportAction(rowNum, timestamp, status, userEmail) {
  return withSheetLock(SHEETS.TRANSPORTION, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');
    const rn = parseInt(rowNum, 10);

    const { headers, rows } = await getSheetData(SHEETS.TRANSPORTION);
    const lastCol = _lastColOf(headers, rows);
    if (lastCol < 28) {
      const toAppend = [];
      for (let c = lastCol + 1; c <= 28; c++) {
        if (c === 26) toAppend.push('Approve Status');
        else if (c === 27) toAppend.push('Approve Timestamp');
        else if (c === 28) toAppend.push('Approve User');
        else toAppend.push('');
      }
      if (toAppend.length > 0) {
        await updateRange(SHEETS.TRANSPORTION, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
      }
    }

    /* Double-check: already approved? */
    const curStatus = rows[rn - 2] ? rows[rn - 2][25] : undefined; // Z
    if (curStatus && String(curStatus).trim().toLowerCase() === 'approved') return 'ALREADY_PROCESSED';

    /* Z=Status, AA=Timestamp, AB=User */
    await updateRange(SHEETS.TRANSPORTION, `Z${rn}:AB${rn}`, [[status || '', new Date(timestamp).toISOString(), userEmail || '']]);
    return 'OK';
  });
}

/* =============================================
   BILLING — TRANSPORTATION   LMS.js 5027-5121
============================================= */
export async function getBillingTransportData() {
  let sheetData;
  try {
    sheetData = await getSheetData(SHEETS.TRANSPORTION);
  } catch (e) {
    return { headers: [], data: [], missing: true, sheetName: SHEETS.TRANSPORTION };
  }
  const { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [] };

  const headers17 = padWidth(headers, 17);
  const allRows = rows.map((r) => padWidth(r, 17));

  /* Auto-create Z to AF headers if missing */
  const lastCol = _lastColOf(headers, rows);
  if (lastCol < 32) {
    const toAppend = [];
    for (let c = lastCol + 1; c <= 32; c++) {
      if (c === 26) toAppend.push('Approve Status');
      else if (c === 27) toAppend.push('Approve Timestamp');
      else if (c === 28) toAppend.push('Approve User');
      else if (c === 29) toAppend.push('Billing Timestamp');
      else if (c === 30) toAppend.push('Billing Attachment');
      else if (c === 31) toAppend.push('Billing User');
      else if (c === 32) toAppend.push('Invoice No');
      else toAppend.push('');
    }
    if (toAppend.length > 0) {
      await updateRange(SHEETS.TRANSPORTION, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
    }
  }

  /* ★ Drop blank columns so the table does not render a wall of empty cells */
  const pick = usefulCols(headers17, allRows, 17);

  const finalData = [];
  for (let i = 0; i < allRows.length; i++) {
    if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;

    /* approved rows only */
    const zVal = rows[i][25]; // Z
    if (!zVal || String(zVal).trim().toLowerCase() !== 'approved') continue;

    /* Skip already billed */
    const adVal = rows[i][29]; // AD = Billing Attachment
    if (adVal && String(adVal).trim() !== '') continue;

    finalData.push({ row: buildDisplayRow(allRows[i], pick, headers17), _rowNum: i + 2 });
  }

  return {
    headers: pick.map((ci) => safeStr(headers17[ci])),
    data: finalData
  };
}

export async function saveBillingTransportAction(rowNum, timestamp, attachmentUrl, userEmail, invoiceNo) {
  return withSheetLock(SHEETS.TRANSPORTION, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');
    const rn = parseInt(rowNum, 10);

    const { headers, rows } = await getSheetData(SHEETS.TRANSPORTION);
    const lastCol = _lastColOf(headers, rows);
    if (lastCol < 32) {
      const toAppend = [];
      for (let c = lastCol + 1; c <= 32; c++) {
        if (c === 26) toAppend.push('Approve Status');
        else if (c === 27) toAppend.push('Approve Timestamp');
        else if (c === 28) toAppend.push('Approve User');
        else if (c === 29) toAppend.push('Billing Timestamp');
        else if (c === 30) toAppend.push('Billing Attachment');
        else if (c === 31) toAppend.push('Billing User');
        else if (c === 32) toAppend.push('Invoice No');
        else toAppend.push('');
      }
      if (toAppend.length > 0) {
        await updateRange(SHEETS.TRANSPORTION, `${colLetter(lastCol)}1:${colLetter(lastCol + toAppend.length - 1)}1`, [toAppend]);
      }
    }

    /* Already billed? */
    const cur = rows[rn - 2] ? rows[rn - 2][29] : undefined; // AD
    if (cur && String(cur).trim() !== '') return 'ALREADY_PROCESSED';

    /* AC=Timestamp, AD=Attachment, AE=User, AF=Invoice */
    await updateRange(SHEETS.TRANSPORTION, `AC${rn}:AF${rn}`, [[new Date(timestamp).toISOString(), attachmentUrl || '', userEmail || '', invoiceNo || '']]);
    return 'OK';
  });
}

/* =============================================
   RECEIVABLES — TRANSPORTATION   LMS.js 5141-5374
============================================= */
export async function getReceivablesTransportData(filterType) {
  let sheetData;
  try {
    sheetData = await getSheetData(SHEETS.TRANSPORTION);
  } catch (e) {
    return { headers: [], data: [], missing: true, sheetName: SHEETS.TRANSPORTION };
  }
  const { headers, rows } = sheetData;
  if (!rows.length) return { headers: [], data: [], totalOutstanding: 0, totalReceived: 0, ageing: {} };

  const headers17 = padWidth(headers, 17);
  const allRows = rows.map((r) => padWidth(r, 17));

  /* Amount column dynamic search */
  let amtCol = -1, billingDateCol = -1;
  for (let h = 0; h < 17; h++) {
    const hdr = String(headers17[h] || '').toLowerCase();
    if (amtCol === -1 && hdr.indexOf('amount') !== -1) amtCol = h;
    if (billingDateCol === -1 && (hdr === 'billing date' || hdr === 'bill date' || hdr === 'invoice date' || hdr === 'date')) billingDateCol = h;
  }
  if (amtCol === -1) amtCol = 2;
  if (billingDateCol === -1) billingDateCol = 0;

  /* ★ Drop blank columns from the display only; amtCol / billingDateCol still
     index the raw 17-column row, so the maths below is unaffected. */
  const pick = usefulCols(headers17, allRows, 17);

  /* Auto-create Z to AR(/AT) headers if missing */
  await _ensureTransportHeaders();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const finalData = [];
  let totalOutstanding = 0, totalReceived = 0;
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

  for (let i = 0; i < allRows.length; i++) {
    if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
    const zVal = rows[i][25]; // Z = Approve Status
    if (!zVal || String(zVal).trim().toLowerCase() !== 'approved') continue;
    const adVal = rows[i][29]; // AD = Billing Attachment
    if (!adVal || String(adVal).trim() === '') continue;

    const amt = typeof allRows[i][amtCol] === 'number' ? allRows[i][amtCol] : 0;
    const recvdRaw = rows[i][35]; // AJ = Total Received
    const recvd = typeof recvdRaw === 'number' ? recvdRaw : 0;
    const outstanding = amt - recvd;
    const hasPartialPayment = recvd > 0;

    /* Payment status */
    const recvStatus = String(rows[i][32] || '').trim().toLowerCase(); // AG = Receivable Status
    // DEVIATION: original checked `instanceof Date` on the native Apps Script
    // Date cell; the REST transport returns a formatted string instead, so
    // this parses it (see receivables.service.js for the same adaptation).
    const hasPayDate = !!parseDate(rows[i][39]); // AN = Payment Date
    const disputeRaw = rows[i][45]; // ★ col 46 (AT), not 45 — see file header quirk note
    const isDisputed = disputeRaw && String(disputeRaw).trim().toLowerCase() === 'disputed';
    const isFullyPaid = (recvStatus === 'paid') || hasPayDate || isDisputed;

    /* ★ partial payments should also show in the Payment tab */
    let include = false;
    if (filterType === 'pending') include = !isFullyPaid;
    else if (filterType === 'payment') include = isFullyPaid || hasPartialPayment;
    if (!include) continue;

    if (filterType === 'pending' && outstanding > 0) totalOutstanding += outstanding;
    if (filterType === 'payment') totalReceived += recvd;

    /* Ageing for pending */
    let days = '', band = '';
    if (filterType === 'pending') {
      const billingDate = parseDate(allRows[i][billingDateCol]);
      if (billingDate) {
        days = Math.ceil((today - billingDate) / 86400000);
        if (days <= 30) band = '0-30';
        else if (days <= 60) band = '31-60';
        else if (days <= 90) band = '61-90';
        else band = '90+';
        if (outstanding > 0) ageing[band] += outstanding;
      }
    }

    /* ★ Pending should also show the Received Amount column */
    let displayRow;
    if (filterType === 'pending') {
      displayRow = buildDisplayRow(allRows[i], pick, headers17);
      displayRow.push(safeAmt(recvd));
    } else {
      displayRow = buildDisplayRow(allRows[i], pick, headers17);
      displayRow.push(safeAmt(recvd));
      displayRow.push(safeStr(rows[i][39])); // AN = Payment Date
      displayRow.push(safeStr(rows[i][42])); // AQ = Payment Log Details
      displayRow.push(safeStr(rows[i][41])); // AP = Payment Log Dates
      displayRow.push(safeStr(rows[i][43])); // AR = Payment Log Users
    }

    finalData.push({
      row: displayRow,
      _rowNum: i + 2,
      daysLeft: days,
      band,
      logV: safeStr(rows[i][36]), // AK Follow-up Dates
      logW: safeStr(rows[i][37]), // AL Follow-up Remarks
      logX: safeStr(rows[i][38]), // AM Follow-up Users
      payLogAD: safeStr(rows[i][40]), // AO Payment Attachment
      payLogV: safeStr(rows[i][41]), // AP Payment Log Dates
      payLogW: safeStr(rows[i][42]), // AQ Payment Log Details
      payLogX: safeStr(rows[i][43]), // AR Payment Log Users
      disputeStatus: safeStr(rows[i][45]) // col 46 (AT) — see quirk note above
    });
  }

  const displayHeaders = pick.map((ci) => safeStr(headers17[ci]));
  if (filterType === 'pending') {
    displayHeaders.push('Received Amount');
  } else {
    displayHeaders.push('Received Amount', 'Payment Date', 'UTR/Amount', 'Payment Log', 'Paid By');
  }

  return {
    headers: displayHeaders,
    data: finalData,
    totalOutstanding,
    totalReceived,
    ageing
  };
}

export async function saveReceivableTransportFollowUp(rowNum, timestamp, remarks, userEmail) {
  return withSheetLock(SHEETS.TRANSPORTION, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');
    if (!remarks || String(remarks).trim() === '') throw new AppError('Remarks are required');
    const rn = parseInt(rowNum, 10);

    await _ensureTransportHeaders();

    const newTs = safeStr(new Date(timestamp));
    const cur = await getRange(SHEETS.TRANSPORTION, `AK${rn}:AM${rn}`);
    const fdV = cur?.[0]?.[0];
    const frV = cur?.[0]?.[1];
    const fuV = cur?.[0]?.[2];

    if (fdV && String(fdV).trim() !== '') {
      await updateRange(SHEETS.TRANSPORTION, `AK${rn}:AM${rn}`, [[`${fdV}\n${newTs}`, `${frV}\n${remarks}`, `${fuV}\n${userEmail || ''}`]]);
    } else {
      await updateRange(SHEETS.TRANSPORTION, `AK${rn}:AM${rn}`, [[newTs, remarks, userEmail || '']]);
    }
    return 'OK';
  });
}

export async function saveReceivableTransportPayment(rowNum, timestamp, amount, utr, remarks, userEmail, attachmentUrl) {
  return withSheetLock(SHEETS.TRANSPORTION, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');
    if (!utr || String(utr).trim() === '') throw new AppError('UTR / Reference is required');
    const newPayment = parseFloat(amount);
    if (isNaN(newPayment) || newPayment <= 0) throw new AppError('Payment amount is required and must be greater than zero');

    const rn = parseInt(rowNum, 10);
    await _ensureTransportHeaders();

    /* Find amount column dynamically */
    const headerRow = await getRange(SHEETS.TRANSPORTION, 'A1:Q1');
    const headers17 = padWidth(headerRow?.[0] || [], 17);
    let amtCol = -1;
    for (let h = 0; h < 17; h++) {
      if (String(headers17[h] || '').toLowerCase().indexOf('amount') !== -1) { amtCol = h; break; }
    }
    if (amtCol === -1) amtCol = 2;

    const invAmtCell = (await getRange(SHEETS.TRANSPORTION, `${colLetter(amtCol)}${rn}:${colLetter(amtCol)}${rn}`))?.[0]?.[0];
    const invAmt = typeof invAmtCell === 'number' ? invAmtCell : 0;
    const curRecvCell = (await getRange(SHEETS.TRANSPORTION, `AJ${rn}:AJ${rn}`))?.[0]?.[0];
    const curRecv = typeof curRecvCell === 'number' ? curRecvCell : 0;

    const newTotal = curRecv + newPayment;
    if (invAmt > 0 && newTotal > invAmt) {
      throw new AppError(`Payment exceeds outstanding of ₹${(invAmt - curRecv).toLocaleString('en-IN')}`);
    }

    /* AJ(36)=Total Received */
    await updateCell(SHEETS.TRANSPORTION, rn, 35, newTotal);

    /* Payment log: AP(42), AQ(43), AR(44) */
    const payDetail = `UTR: ${utr} | ₹${newPayment.toLocaleString('en-IN')}${remarks ? ' | ' + remarks : ''}`;
    const payDate = safeStr(new Date(timestamp));

    const logCells = await getRange(SHEETS.TRANSPORTION, `AP${rn}:AR${rn}`);
    const apV = logCells?.[0]?.[0];
    const aqV = logCells?.[0]?.[1];
    const arV = logCells?.[0]?.[2];
    if (apV && String(apV).trim() !== '') {
      await updateRange(SHEETS.TRANSPORTION, `AP${rn}:AR${rn}`, [[`${apV}\n${payDate}`, `${aqV}\n${payDetail}`, `${arV}\n${userEmail || ''}`]]);
    } else {
      await updateRange(SHEETS.TRANSPORTION, `AP${rn}:AR${rn}`, [[payDate, payDetail, userEmail || '']]);
    }

    /* AO(41)=Payment Attachment */
    if (attachmentUrl) {
      const aoCell = (await getRange(SHEETS.TRANSPORTION, `AO${rn}:AO${rn}`))?.[0]?.[0];
      const aoV = safeStr(aoCell);
      await updateCell(SHEETS.TRANSPORTION, rn, 40, aoV.trim() !== '' ? `${aoV}\n${attachmentUrl}` : attachmentUrl);
    }

    /* AG(33)=Status, AH(34)=Timestamp, AI(35)=User, AN(40)=Payment Date */
    if (newTotal >= invAmt && invAmt > 0) {
      await updateRange(SHEETS.TRANSPORTION, `AG${rn}:AI${rn}`, [['Paid', safeStr(new Date(timestamp)), userEmail || '']]);
      await updateCell(SHEETS.TRANSPORTION, rn, 39, safeStr(new Date(timestamp))); // AN
      return 'FULL';
    } else {
      await updateRange(SHEETS.TRANSPORTION, `AG${rn}:AI${rn}`, [['Partial Payment', safeStr(new Date(timestamp)), userEmail || '']]);
      return 'PARTIAL';
    }
  });
}

/* =============================================
   BULK BILLING — fans out across Lease / Transportion / Other categories
   LMS.js 5397-5469
============================================= */
export async function saveBulkBillingAction(identifiers, timestamp, attachmentUrl, userEmail, invoiceNo, category) {
  let saved = 0, skipped = 0;
  identifiers = identifiers || [];

  if (category === 'Lease') {
    /* ★ identifiers are exact row numbers (see original's ★ FIX comment —
       matching a container by scanning for the first row with that number
       would silently update the wrong row if a container had >1 pending
       row). */
    await withSheetLock(SHEETS.BILLING_SALES, async () => {
      const colA = await getRange(SHEETS.BILLING_SALES, 'A2:A');
      const lr = colA.length + 1; // +1 for header row
      if (lr < 2) throw new AppError('No data in Billing Sales');
      for (const identifier of identifiers) {
        const rn = parseInt(identifier, 10);
        if (!rn || rn < 2 || rn > lr) { skipped++; continue; }
        const curTsCell = await getRange(SHEETS.BILLING_SALES, `AB${rn}:AB${rn}`);
        const curTs = curTsCell?.[0]?.[0];
        if (curTs && String(curTs).trim() !== '') { skipped++; continue; }
        // AB, AC, AD, AE
        await updateRange(SHEETS.BILLING_SALES, `AB${rn}:AE${rn}`, [[new Date(timestamp).toISOString(), attachmentUrl || '', userEmail || '', invoiceNo || '']]);
        saved++;
      }
    });
  } else if (category === 'Transportion') {
    await withSheetLock(SHEETS.TRANSPORTION, async () => {
      await _ensureTransportHeaders();
      const { rows } = await getSheetData(SHEETS.TRANSPORTION);
      const lr = rows.length + 1;
      for (const identifier of identifiers) {
        const rn = identifier;
        if (rn < 2 || rn > lr) { skipped++; continue; }
        const curCell = await getRange(SHEETS.TRANSPORTION, `AD${rn}:AD${rn}`);
        const cur = curCell?.[0]?.[0];
        if (cur && String(cur).trim() !== '') { skipped++; continue; }
        await updateRange(SHEETS.TRANSPORTION, `AC${rn}:AF${rn}`, [[new Date(timestamp).toISOString(), attachmentUrl || '', userEmail || '', invoiceNo || '']]);
        saved++;
      }
    });
  } else {
    await withSheetLock(SHEETS.BILLING_CATEGORY, async () => {
      const { headers, rows } = await getSheetData(SHEETS.BILLING_CATEGORY);
      const lr = rows.length + 1;
      const lc = _lastColOf(headers, rows);
      const headersLc = padWidth(headers, lc);

      const cols = {};
      for (let h = 0; h < lc; h++) {
        const hdr = String(headersLc[h] || '').trim().toLowerCase();
        if (hdr === 'billing attachment') cols.a = h;
        else if (hdr === 'billing timestamp') cols.t = h;
        else if (hdr === 'billing user') cols.u = h;
        else if (hdr === 'invoice no') cols.i = h;
      }
      const toAppend = [];
      if (cols.a === undefined) { cols.a = lc + toAppend.length; toAppend.push('Billing Attachment'); }
      if (cols.t === undefined) { cols.t = lc + toAppend.length; toAppend.push('Billing Timestamp'); }
      if (cols.u === undefined) { cols.u = lc + toAppend.length; toAppend.push('Billing User'); }
      if (cols.i === undefined) { cols.i = lc + toAppend.length; toAppend.push('Invoice No'); }
      if (toAppend.length > 0) {
        await updateRange(SHEETS.BILLING_CATEGORY, `${colLetter(lc)}1:${colLetter(lc + toAppend.length - 1)}1`, [toAppend]);
      }

      for (const identifier of identifiers) {
        const rn = identifier;
        if (rn < 2 || rn > lr) { skipped++; continue; }
        if (cols.a >= 0) {
          const curCell = await getRange(SHEETS.BILLING_CATEGORY, `${colLetter(cols.a)}${rn}:${colLetter(cols.a)}${rn}`);
          const cur = curCell?.[0]?.[0];
          if (cur && String(cur).trim() !== '') { skipped++; continue; }
        }
        if (cols.t >= 0) await updateCell(SHEETS.BILLING_CATEGORY, rn, cols.t, new Date(timestamp).toISOString());
        if (cols.a >= 0) await updateCell(SHEETS.BILLING_CATEGORY, rn, cols.a, attachmentUrl || '');
        if (cols.u >= 0) await updateCell(SHEETS.BILLING_CATEGORY, rn, cols.u, userEmail || '');
        if (cols.i >= 0) await updateCell(SHEETS.BILLING_CATEGORY, rn, cols.i, invoiceNo || '');
        saved++;
      }
    });
  }

  let msg = `Invoice ${invoiceNo} saved to ${saved} container(s)`;
  if (skipped > 0) msg += `. Skipped ${skipped} already processed.`;
  return msg;
}
