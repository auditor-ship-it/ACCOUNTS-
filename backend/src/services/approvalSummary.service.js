/**
 * Port of LMS.js lines 4742-4924: getApprovalSummaryData — a cross-cutting
 * dashboard aggregator that reads ALREADY-APPROVED rows out of four sheets
 * (Operation sheet / New Lease Other Order type / Approve billing for
 * invoice / Transportion) and returns them grouped for the "Approval
 * Summary" screen.
 *
 * NOTE: the original does NOT call getApproveData() / getApproveCategoryData()
 * / getBillingData() (the sibling "pending work" list functions ported in
 * approve.service.js / approveCategory.service.js / billing.service.js) —
 * it re-reads each sheet directly with its own column picks and its own
 * "already approved" filter (the exact opposite filter direction from those
 * list screens, which show PENDING/not-yet-approved rows). This port keeps
 * that same self-contained structure rather than introducing a dependency on
 * those other services, to avoid coupling to list-screen logic that filters
 * for the opposite condition.
 *
 * DEVIATION — "★ ISO string for date filtering": the original checks
 * `cell instanceof Date` (Apps Script's getValues() returns genuine Date
 * objects for date-typed cells) and calls `.toISOString()`. The Sheets REST
 * API used by googleSheets.service.js returns dates as FORMATTED_STRING
 * text instead (see receivables.service.js's file-header note for the same
 * issue elsewhere in this migration), so this port parses the string with
 * parseDate() instead of an instanceof check. Because the four source sheets
 * were written by three different sibling services using three different
 * timestamp text encodings (ISO 8601 from approveCategory.service.js /
 * billing.service.js / this file's own transport.service.js; "dd/MM/yyyy
 * HH:mm:ss" from approve.service.js's dmyTime()), toISOOrEmpty() below tries
 * the full string first (parseDate's own fallback already parses ISO 8601
 * natively via `new Date(s)`) and, if that fails, retries with just the
 * leading date token (handles "dd/MM/yyyy HH:mm:ss", whose trailing time
 * breaks parseDate's dd/MM/yyyy regex because of its `$` anchor).
 */
import { getSheetData } from './googleSheets.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, parseDate } from '../utils/format.js';
import { _ensureTransportHeaders } from './transport.service.js';

function padWidth(arr, width) {
  const out = (arr || []).slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

function lastColOf(headers, rows) {
  let n = headers.length;
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

function toISOOrEmpty(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (!s) return '';
  let d = parseDate(s);
  if (!d) {
    const datePart = s.split(' ')[0];
    if (datePart !== s) d = parseDate(datePart);
  }
  return d ? d.toISOString() : '';
}

function fmtCurrencyOrStr(val) {
  return typeof val === 'number'
    ? '₹' + Math.ceil(val).toLocaleString('en-IN')
    : safeStr(val);
}

export async function getApprovalSummaryData() {
  const result = {
    lease: { headers: [], data: [], sectionTitle: 'Lease Approvals' },
    category: { headers: [], data: [], sectionTitle: 'Sale / Accessories / Other Approvals' },
    billing: { headers: [], data: [], sectionTitle: 'Billing Approvals' },
    transport: { headers: [], data: [], sectionTitle: 'Transportation Approvals' }
  };

  /* ---- 1. LEASE — Operation sheet ---- */
  try {
    const { headers, rows } = await getSheetData(SHEETS.OPERATION);
    if (rows.length) {
      const allHeaders = padWidth(headers, 31);
      const allRows = rows.map((r) => padWidth(r, 31));
      const pick = [0, 1, 2, 3, 4, 5, 6];
      const displayHeaders = pick.map((ci) => safeStr(allHeaders[ci]));
      displayHeaders.push('Approved Date', 'Approved By');

      for (let i = 0; i < allRows.length; i++) {
        if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
        if (safeStr(allRows[i][29]).toLowerCase() !== 'approved') continue;
        const row = pick.map((ci) => safeStr(allRows[i][ci]));
        row.push(toISOOrEmpty(allRows[i][28])); // AC = Approve Timestamp
        row.push(safeStr(allRows[i][30])); // AE = Approve User
        result.lease.data.push(row);
      }
      result.lease.headers = displayHeaders;
    }
  } catch (e) { console.log('ApprovalSummary Lease: ' + e.message); }

  /* ---- 2. CATEGORY — New Lease Other Order type ---- */
  try {
    const { headers, rows } = await getSheetData(SHEETS.APPROVE_BILLING);
    const lc = lastColOf(headers, rows);
    if (rows.length && lc >= 4) {
      const headersLc = padWidth(headers, lc);
      let statusCol = -1, tsCol = -1, userCol = -1;
      for (let h = 0; h < lc; h++) {
        const hdr = String(headersLc[h] || '').trim().toLowerCase();
        if (hdr === 'approve status') statusCol = h;
        else if (hdr === 'approve timestamp') tsCol = h;
        else if (hdr === 'approve user') userCol = h;
      }
      if (statusCol >= 0) {
        const show = Math.min(7, lc);
        const displayHeaders = [];
        for (let h = 0; h < show; h++) displayHeaders.push(safeStr(headersLc[h]));
        displayHeaders.push('Approved Date', 'Approved By');

        const allRows = rows.map((r) => padWidth(r, lc));
        for (let i = 0; i < allRows.length; i++) {
          if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
          if (safeStr(allRows[i][statusCol]).toLowerCase() !== 'approved') continue;
          const row = [];
          for (let c = 0; c < show; c++) row.push(safeStr(allRows[i][c]));
          row.push(tsCol >= 0 ? toISOOrEmpty(allRows[i][tsCol]) : '');
          row.push(userCol >= 0 ? safeStr(allRows[i][userCol]) : '');
          result.category.data.push(row);
        }
        result.category.headers = displayHeaders;
      }
    }
  } catch (e) { console.log('ApprovalSummary Category: ' + e.message); }

  /* ---- 3. BILLING — Approve billing for invoice ---- */
  try {
    const { rows } = await getSheetData(SHEETS.BILLING_CATEGORY);
    if (rows.length) {
      const allRows = rows.map((r) => padWidth(r, 26));
      const displayHeaders = [
        'Container', 'Client Code', 'Client Name', 'Size', 'Type',
        'Location', 'Rate', 'Amount', 'Month', 'Year',
        'Approved Date', 'Approved By'
      ];
      const bPick = [0, 1, 2, 3, 4, 5, 8, 12, 10, 11];

      for (let i = 0; i < allRows.length; i++) {
        if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
        if (safeStr(allRows[i][23]).toLowerCase() !== 'approved') continue;
        const row = bPick.map((ci) => (ci === 8 || ci === 12) ? fmtCurrencyOrStr(allRows[i][ci]) : safeStr(allRows[i][ci]));
        row.push(toISOOrEmpty(allRows[i][24])); // Y = Approved Date
        row.push(safeStr(allRows[i][25])); // Z = Approved By
        result.billing.data.push(row);
      }
      result.billing.headers = displayHeaders;
    }
  } catch (e) { console.log('ApprovalSummary Billing: ' + e.message); }

  /* ---- 4. TRANSPORTATION — "Transportion" sheet ---- */
  try {
    const { headers, rows } = await getSheetData(SHEETS.TRANSPORTION);
    if (rows.length) {
      const headers17 = padWidth(headers, 17);
      const allRows = rows.map((r) => padWidth(r, 17));

      /* Auto-create Z:AT if missing */
      await _ensureTransportHeaders();

      const show = Math.min(7, 17);
      const displayHeaders = [];
      for (let h = 0; h < show; h++) displayHeaders.push(safeStr(headers17[h]));
      displayHeaders.push('Approved Date', 'Approved By');

      for (let i = 0; i < allRows.length; i++) {
        if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
        const zVal = rows[i][25]; // Z = Approve Status
        if (!zVal || String(zVal).trim().toLowerCase() !== 'approved') continue;

        const row = [];
        for (let c = 0; c < show; c++) row.push(safeStr(allRows[i][c]));
        row.push(toISOOrEmpty(rows[i][26])); // AA = Approve Timestamp
        row.push(safeStr(rows[i][27])); // AB = Approve User
        result.transport.data.push(row);
      }
      result.transport.headers = displayHeaders;
    }
  } catch (e) { console.log('ApprovalSummary Transport: ' + e.message); }

  /* ---- 5. TRANSPORT BILLING — same sheet AC:AF, appended into `billing` ---- */
  try {
    const { headers, rows } = await getSheetData(SHEETS.TRANSPORTION);
    if (rows.length) {
      const headers17 = padWidth(headers, 17);
      const allRows = rows.map((r) => padWidth(r, 17));

      await _ensureTransportHeaders();

      /* Amount column dynamic search */
      let amtCol = -1;
      for (let h = 0; h < 17; h++) {
        if (String(headers17[h] || '').toLowerCase().indexOf('amount') !== -1) { amtCol = h; break; }
      }
      if (amtCol === -1) amtCol = 2;

      const pick = [0, 1, 2, 3, 4, 5, amtCol];

      for (let i = 0; i < allRows.length; i++) {
        if (!allRows[i][0] || String(allRows[i][0]).trim() === '') continue;
        const zVal = rows[i][25]; // Z = Approve Status
        if (!zVal || String(zVal).trim().toLowerCase() !== 'approved') continue;
        const adVal = rows[i][29]; // AD = Billing Attachment
        if (!adVal || String(adVal).trim() === '') continue;

        const row = pick.map((ci) => (ci === amtCol) ? fmtCurrencyOrStr(allRows[i][ci]) : safeStr(allRows[i][ci]));
        row.push(toISOOrEmpty(rows[i][28])); // AC = Billing Timestamp
        row.push(safeStr(rows[i][30])); // AE = Billing User
        result.billing.data.push(row);
      }
    }
  } catch (e) { console.log('ApprovalSummary TransportBilling: ' + e.message); }

  return result;
}
