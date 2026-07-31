/**
 * Port of LMS.js lines 1491-2117 (Billing Sales list, save-billing action,
 * the "Invoice Template" fetch pipeline, billing-sales housekeeping tools,
 * and the Advance/End invoice generator).
 *
 * Functions ported here: getBillingData, saveBillingAction, _normKey,
 * _splitContainers, _tabToMonth, _toMonthNum, _buildInvoiceTemplateMap,
 * _fetchBillingInvoiceCore, fetchBillingInvoiceFromTemplate,
 * whoOpensTheTemplate, cleanOrphanBillingRows, _deleteRowsBatched,
 * removeDuplicateBillingRows, debugFetchContainer, autoFetchBillingInvoice,
 * generateAdvanceInvoice, generateEndInvoice, generateInvoiceByType.
 *
 * Trigger-setup functions (setupAllSeparateTriggers, setupAutoFetchTrigger,
 * setupMonthlyInvoiceTrigger, removeMonthlyInvoiceTrigger,
 * removeAutoFetchTrigger, setupAdvanceEndInvoiceTriggers,
 * removeAdvanceEndInvoiceTriggers) are NOT re-implemented here — see
 * jobs/billingTriggers.js for the documented schedule these functions are
 * meant to run on; the underlying work functions below are what a future
 * node-cron registration (or the admin endpoints in billing.routes.js) call.
 *
 * DEPENDENCY NOTE: fetchBillingInvoiceFromTemplate and autoFetchBillingInvoice
 * both call _fetchBillingTypeToDeployedCore (LMS.js line 2147), which is the
 * function immediately AFTER this file's assigned range (1358-2146 is the
 * expiry/billing assignment's LMS.js range; this service's own range ends at
 * line 2117 / 2146 depending on how you count generateInvoiceByType's closing
 * brace). It is ported here as a dependency, faithfully, so those two
 * in-range functions behave identically. Its manual wrapper
 * (fetchBillingTypeToDeployed, LMS.js 2218) and the "Fill Client Code by
 * Company Name" section right after it belong to a different porting range
 * and are intentionally NOT included here.
 */
import {
  getSheetsClient,
  getSheetData,
  getRange,
  updateRange,
  batchUpdateValues,
  appendRows,
  deleteRows,
  colLetter
} from './googleSheets.service.js';
import { buildDisplayRow, parseDate } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { checkActionPermission } from './permissions.service.js';
import { AppError } from '../utils/AppError.js';
import { SHEETS, EXTERNAL_SPREADSHEETS } from '../config/sheets.config.js';
import { env } from '../config/env.js';
import { normKey, splitContainers } from '../utils/normalize.js';

/* =============================================
   getBillingData — LMS.js 1491-1533
============================================= */
export async function getBillingData() {
  const { headers, rows } = await getSheetData(SHEETS.BILLING_SALES);
  if (!rows.length) return { headers: [], data: [], stageIdx: -1 };

  const displayHeaders = headers.slice(0, 22);
  while (displayHeaders.length < 22) displayHeaders.push('');

  let stageIdx = -1;
  for (let h = 0; h < 22; h++) {
    if (displayHeaders[h] && String(displayHeaders[h]).toLowerCase().indexOf('stage') !== -1) { stageIdx = h; break; }
  }

  /* ★ Set of "new" (not yet Moved) containers in New Lease -> green highlight */
  const newSet = {};
  try {
    const { rows: nlRows } = await getSheetData(SHEETS.NEW_LEASE, undefined, 'A1:AD');
    for (const row of nlRows) {
      const c = _normKey(row[0]);
      if (!c) continue;
      if (String(row[29] || '').trim().toLowerCase() !== 'moved') newSet[c] = true; // AD != "Moved" = new
    }
  } catch (e) { /* best-effort, matches original's empty catch */ }

  const finalData = [];
  rows.forEach((row, i) => {
    if (!row[0] || String(row[0]).trim() === '') return;
    /* ★ Invoice (AE, index 30) filled = billed -> it's in Receivables -> hide from Billing list */
    if (row[30] && String(row[30]).trim() !== '') return;
    if (!row[27] || String(row[27]).trim() === '') {
      if (row[31] && String(row[31]).trim().toLowerCase() === 'pending') return;
      const cont = String(row[0]).trim();
      let isNew = false;
      const cparts = _splitContainers(cont);
      for (const cp of cparts) { if (newSet[_normKey(cp)]) { isNew = true; break; } }
      finalData.push({ row: buildDisplayRow(row, 22, displayHeaders), _rowNum: i + 2, _isNew: isNew });
    }
  });

  return { headers: displayHeaders, data: finalData, stageIdx };
}

/* =============================================
   saveBillingAction — LMS.js 1543-1558
============================================= */
export async function saveBillingAction(rowNum, timestamp, attachmentUrl, userEmail, invoiceNo, callerEmail) {
  await checkActionPermission('billing', callerEmail);
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');
    const rn = parseInt(rowNum, 10);
    const colA = await getRange(SHEETS.BILLING_SALES, 'A2:A');
    const lastRow = colA.length + 1; // +1 for header row
    if (rn < 2 || rn > lastRow) throw new AppError('Row out of range');

    const curTsCell = await getRange(SHEETS.BILLING_SALES, `AB${rn}:AB${rn}`);
    const curTs = curTsCell?.[0]?.[0];
    if (curTs && String(curTs).trim() !== '') return 'ALREADY_PROCESSED';

    // ★ SPEED: 4 setValue -> 1 batch setValues (AB:AE contiguous)
    await updateRange(SHEETS.BILLING_SALES, `AB${rn}:AE${rn}`, [[new Date(timestamp).toISOString(), attachmentUrl || '', userEmail || '', invoiceNo || '']]);
    return 'OK';
  });
}

/* =============================================
   FETCH INVOICE NO + ATTACHMENT INTO BILLING SALES   (MONTH-AWARE)
   LMS.js 1560-1881
============================================= */
const INVOICE_TEMPLATE_SS_ID = EXTERNAL_SPREADSHEETS.INVOICE_TEMPLATE.ssId;

/* ★ Auto-fetch only up to this (year*100+month) — after that, manual upload. */
const FETCH_CUTOFF_YM = 202607;

/* ★ Container key normalize — trim + lowercase + extra spaces collapse.
   DELEGATES to utils/normalize.js (the shared, canonical port of this exact
   LMS.js helper — see that file's header) rather than redefining it, so
   there is exactly one implementation for every domain to share. Re-exported
   under the original LMS.js name so callers that import `_normKey` /
   `_splitContainers` from this file (per this porting pass's assignment)
   keep working. */
export const _normKey = normKey;
export const _splitContainers = splitContainers;

/* Template tab name -> month number (1-12). April = base "invoiceTemplate". */
export function _tabToMonth(name) {
  const ln = String(name || '').trim().toLowerCase();
  if (ln === 'invoicetemplate') return 4; // April (base, no suffix)
  if (ln.indexOf('invoicetemplate_') !== 0) return null;
  const suf = ln.substring('invoicetemplate_'.length);
  const full = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
  };
  return full[suf] || full[suf.substring(0, 3)] || null;
}

/* Any value (5 / "5" / "May" / "MAY") -> month number (1-12) */
export function _toMonthNum(val) {
  const s = String(val == null ? '' : val).trim().toLowerCase();
  if (s === '') return null;
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return (n >= 1 && n <= 12) ? n : null; }
  const m = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  return m[s.substring(0, 3)] || null;
}

/* byMonth[monthNum] = { containerNo: { invoice, attachment } } */
export async function _buildInvoiceTemplateMap() {
  let sheetsMeta;
  try {
    const client = getSheetsClient();
    const meta = await client.spreadsheets.get({ spreadsheetId: INVOICE_TEMPLATE_SS_ID });
    sheetsMeta = meta.data.sheets || [];
  } catch (e) {
    throw new AppError(`Could not open the Invoice Template spreadsheet. Check access. (${e.message})`);
  }

  const byMonth = {};
  const tabsRead = [];
  for (const sh of sheetsMeta) {
    const tabName = sh.properties.title;
    const monthNum = _tabToMonth(tabName);
    if (monthNum === null) continue; // only invoiceTemplate month-tabs

    const { headers, rows } = await getSheetData(tabName, INVOICE_TEMPLATE_SS_ID);
    if (rows.length < 1 || headers.length < 1) continue;

    let contCol = -1, invCol = -1, attCol = -1, partyCol = -1;
    for (let h = 0; h < headers.length; h++) {
      const hd = String(headers[h] || '').trim().toLowerCase();
      if (contCol === -1 && hd.indexOf('container') !== -1) contCol = h;
      else if (invCol === -1 && hd.indexOf('invoice') !== -1 && hd.indexOf('number') !== -1) invCol = h;
      else if (attCol === -1 && hd.indexOf('attach') !== -1) attCol = h;
      else if (partyCol === -1 && hd.indexOf('party') !== -1) partyCol = h;
    }
    if (invCol === -1) {
      for (let h2 = 0; h2 < headers.length; h2++) {
        const hd2 = String(headers[h2] || '').trim().toLowerCase();
        if (hd2.indexOf('invoice') !== -1 && (hd2 === 'invoice' || hd2.indexOf('no') !== -1)) { invCol = h2; break; }
      }
    }
    /* Fallback to known positions: B=Container, C=Party, E=Invoice, H=attachments */
    if (contCol === -1) contCol = 1;
    if (invCol === -1) invCol = 4;
    if (attCol === -1) attCol = 7;
    if (partyCol === -1) partyCol = 2; // eslint-disable-line no-unused-vars

    const map = byMonth[monthNum] || (byMonth[monthNum] = {});
    /* ★ FILL-DOWN: if invoice is blank, take the last (above) invoice + attachment. */
    let lastInv = '', lastAtt = '';
    for (const row of rows) {
      const cn = String(row[contCol] || '').trim();
      const rawInv = String(row[invCol] || '').trim();
      const rawAtt = attCol < row.length ? String(row[attCol] || '').trim() : '';

      if (rawInv) { lastInv = rawInv; lastAtt = rawAtt; }
      else if (rawAtt) { lastAtt = rawAtt; }

      if (!cn) continue;
      const inv = rawInv || lastInv;
      const att = rawAtt || lastAtt;
      if (!inv && !att) continue;
      const ck = _normKey(cn);
      if (!map[ck]) map[ck] = { invoice: inv, attachment: att }; // first match wins
    }
    tabsRead.push(`${tabName} (M${monthNum})`);
  }
  return { byMonth, tabs: tabsRead };
}

/* Core worker — no permission check here (both manual + auto call this) */
export async function _fetchBillingInvoiceCore() {
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const built = await _buildInvoiceTemplateMap();
    const { byMonth } = built;

    const { rows } = await getSheetData(SHEETS.BILLING_SALES);
    if (!rows.length) return 'No data in Billing Sales.';

    const n = rows.length;
    let updated = 0, notFound = 0, noMonth = 0, noMonthSheet = 0, afterCutoff = 0;
    const acOut = [], aeOut = [];

    for (let i = 0; i < n; i++) {
      const raw = String(rows[i][0] || '').trim();
      let ac = rows[i][28] != null ? rows[i][28] : ''; // AC = Attachment
      let ae = rows[i][30] != null ? rows[i][30] : ''; // AE = Invoice No

      do {
        if (!raw) break;

        /* ★ The row's Month -> the map for that month's template sheet */
        const mnum = _toMonthNum(rows[i][21]); // V = Month
        if (!mnum) { noMonth++; break; }

        /* ★ Auto-fetch only up to the cutoff; beyond it, upload manually -> skip */
        const yr = parseInt(String(rows[i][22] || '').trim(), 10); // W = Year
        const allowed = !isNaN(yr) ? ((yr * 100 + mnum) <= FETCH_CUTOFF_YM) : (mnum >= 4 && mnum <= 6);
        if (!allowed) { afterCutoff++; break; }

        const monthMap = byMonth[mnum];
        if (!monthMap) { noMonthSheet++; break; }

        /* ★ Multi-container (comma separated) -> first match. */
        const parts = _splitContainers(raw);
        let m = null;
        for (const part of parts) {
          const key = _normKey(part);
          if (key && monthMap[key]) { m = monthMap[key]; break; }
        }
        if (!m) {
          /* ★ Container not found in this month's template -> CLEAR old/wrong invoice+attachment */
          ae = ''; ac = '';
          notFound++;
          break;
        }
        ae = m.invoice || '';
        ac = m.attachment || '';
        updated++;
      } while (false);

      acOut.push(ac);
      aeOut.push(ae);
    }

    await batchUpdateValues([
      { range: `'${SHEETS.BILLING_SALES}'!AC2:AC${n + 1}`, values: acOut.map((v) => [v]) },
      { range: `'${SHEETS.BILLING_SALES}'!AE2:AE${n + 1}`, values: aeOut.map((v) => [v]) }
    ]);

    return `Done. Updated ${updated} | Not found: ${notFound} | Month blank: ${noMonth} | Month-sheet missing: ${noMonthSheet} | After-June (skipped/manual): ${afterCutoff} | Tabs: ${built.tabs.join(', ') || 'none'}`;
  });
}

/* Manual / from button — billing permission required */
export async function fetchBillingInvoiceFromTemplate(callerEmail) {
  await checkActionPermission('billing', callerEmail);
  const msg1 = await _fetchBillingInvoiceCore();
  const msg2 = await _fetchBillingTypeToDeployedCore(); // ★ Billing Type -> Deployed sheet
  return `${msg1}  ||  BillingType: ${msg2}`;
}

/* ★★★ DIAGNOSTIC — reports which service account the backend runs as (the
   account the Invoice Template file must be shared with), and whether it can
   open the file. Changes nothing.
   DEVIATION: the original also reported the Apps Script "active user" (the
   person who clicked the button) via Session.getActiveUser() — there is no
   equivalent concept for a stateless Node/Express service account backend,
   so that section is omitted here. */
export async function whoOpensTheTemplate() {
  const out = [];
  const effective = env.googleClientEmail || '(unavailable)';

  out.push(`Template file ID : ${INVOICE_TEMPLATE_SS_ID}`);
  out.push('');
  out.push(`Backend runs as (service account): ${effective}`);
  out.push('   ^^^ THIS is the account that must have access to the template file.');
  out.push('       Share the Invoice Template with this exact address (Viewer is enough).');
  out.push('');

  try {
    const client = getSheetsClient();
    const meta = await client.spreadsheets.get({ spreadsheetId: INVOICE_TEMPLATE_SS_ID });
    out.push(`OPEN TEST: SUCCESS  -> '${meta.data.properties?.title || ''}'`);
    out.push('If Fetch still errored a moment ago, retry now — access is working.');
  } catch (e) {
    out.push('OPEN TEST: FAILED');
    out.push(`   ${e.message}`);
    out.push(`   Fix: open the Invoice Template file -> Share -> add '${effective}' as Viewer.`);
    out.push('        (Or share it with the whole crystalgroup.in domain.)');
  }

  const msg = out.join('\n');
  console.log(msg);
  return msg;
}

/* ★ CLEANUP — rows where Container (A) is blank but invoice/attachment exists
   are orphan/garbage. Clear their AE + AC. */
export async function cleanOrphanBillingRows(callerEmail) {
  await checkActionPermission('billing', callerEmail);
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const { rows } = await getSheetData(SHEETS.BILLING_SALES);
    if (!rows.length) return 'No data in Billing Sales.';

    const n = rows.length;
    const acOut = [], aeOut = [];
    let cleaned = 0;
    for (let i = 0; i < n; i++) {
      const cont = String(rows[i][0] || '').trim();
      let ac = rows[i][28] != null ? rows[i][28] : '';
      let ae = rows[i][30] != null ? rows[i][30] : '';
      if (!cont) {
        const hasInv = String(ae || '').trim() !== '';
        const hasAtt = String(ac || '').trim() !== '';
        if (hasInv || hasAtt) { ae = ''; ac = ''; cleaned++; }
      }
      acOut.push(ac);
      aeOut.push(ae);
    }
    await batchUpdateValues([
      { range: `'${SHEETS.BILLING_SALES}'!AC2:AC${n + 1}`, values: acOut.map((v) => [v]) },
      { range: `'${SHEETS.BILLING_SALES}'!AE2:AE${n + 1}`, values: aeOut.map((v) => [v]) }
    ]);
    return `Cleaned ${cleaned} orphan row(s) (removed invoice/attachment with no container).`;
  });
}

/* ★ Fast bulk row delete.
   DEVIATION: the original grouped consecutive row numbers into ranges and
   issued one deleteRows(start,count) Apps Script call per contiguous group.
   googleSheets.service.js's deleteRows() already achieves the same goal a
   different way — every row number, contiguous or not, is deleted via a
   SINGLE Sheets API batchUpdate call (one deleteDimension request per row,
   highest row first so indices never shift), which is at least as fast and
   simpler than replicating the grouping logic on top of the REST API. This
   wrapper preserves the original function's name/signature/return contract
   (rows deleted count) for callers/other domains that import it directly. */
export async function _deleteRowsBatched(sheetName, rowNums) {
  if (!rowNums || !rowNums.length) return 0;
  await deleteRows(sheetName, rowNums);
  return new Set(rowNums).size;
}

/* ★ Remove DUPLICATE Billing Sales rows — same Container + Month + Year + Amount. */
export async function removeDuplicateBillingRows(callerEmail) {
  await checkActionPermission('billing', callerEmail);
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const { rows } = await getSheetData(SHEETS.BILLING_SALES);
    if (!rows.length) return 'No data in Billing Sales.';

    /* ★ SAFETY: if these rows come from a formula, deleting them is pointless. */
    const client = getSheetsClient();
    const formulaRes = await client.spreadsheets.values.get({
      spreadsheetId: env.googleSheetId,
      range: `'${SHEETS.BILLING_SALES}'!A2`,
      valueRenderOption: 'FORMULA'
    });
    const a2f = formulaRes.data.values?.[0]?.[0];
    const isFormula = typeof a2f === 'string' && a2f.startsWith('=');
    if (isFormula) {
      return `ABORTED: Billing Sales A2 holds a formula (${a2f}). These rows are generated, ` +
        'not stored. Deleting them will not work — fix the duplicate at its source ' +
        '(Deployed sheet / Operation sheet) instead.';
    }

    const n = rows.length;
    const seen = {}, dupRows = [];
    for (let i = 0; i < n; i++) {
      const cn = String(rows[i][0] || '').trim();
      if (!cn) continue;
      const key = `${_normKey(cn)}|${String(rows[i][21] ?? '').trim()}|${String(rows[i][22] ?? '').trim()}|${String(rows[i][19] ?? '').trim()}`; // container|month|year|amount
      if (seen[key]) dupRows.push(i + 2); // duplicate -> delete
      else seen[key] = true;
    }
    const removed = await _deleteRowsBatched(SHEETS.BILLING_SALES, dupRows);
    console.log(`[BILL-DEDUP] removed ${removed} row(s)`);
    return `Removed ${removed} duplicate Billing Sales row(s) (same container+month+year+amount).`;
  });
}

/* ★ DEBUG — tells whether a container exists in the template (month-tabs) or not. */
export async function debugFetchContainer(containerNo) {
  const cn = _normKey(containerNo || 'GESU9563904');
  const built = await _buildInvoiceTemplateMap();
  const { byMonth } = built;
  const found = [];
  for (const m of Object.keys(byMonth)) {
    if (byMonth[m][cn]) found.push(`Month ${m} -> ${JSON.stringify(byMonth[m][cn])}`);
  }
  const out = `Container '${cn}' -> ${found.length ? found.join('  |  ') : 'NOT found in TEMPLATE'}  ||  Tabs read: ${built.tabs.join(', ') || 'none'}`;
  console.log(out);
  return out;
}

/* Auto via time-trigger — only FETCH (invoice/attachment + billing type/client code). */
export async function autoFetchBillingInvoice() {
  try {
    const msg = await _fetchBillingInvoiceCore();
    console.log(`[AUTO-FETCH] ${msg}`);
  } catch (e) {
    console.log(`[AUTO-FETCH] ERROR: ${e.message}`);
  }
  try {
    const msg2 = await _fetchBillingTypeToDeployedCore();
    console.log(`[AUTO-BILLTYPE] ${msg2}`);
  } catch (e2) {
    console.log(`[AUTO-BILLTYPE] ERROR: ${e2.message}`);
  }
}

/* =============================================
   FETCH BILLING TYPE + CLIENT CODE -> DEPLOYED SHEET (LMS.js 2147-2215)
   Dependency of fetchBillingInvoiceFromTemplate / autoFetchBillingInvoice —
   see file header DEPENDENCY NOTE.
============================================= */
export async function _fetchBillingTypeToDeployedCore() {
  return withSheetLock(SHEETS.DEPLOYED, async () => {
    /* 1. New Lease -> map: container -> { bt: Billing Type, cc: Client Code } */
    const { headers: nlHeaders, rows: nlRows } = await getSheetData(SHEETS.NEW_LEASE);
    if (!nlRows.length) return 'No data in New Lease.';
    let nlBtCol = -1, nlCcCol = -1;
    for (let h = 0; h < nlHeaders.length; h++) {
      const hd = String(nlHeaders[h] || '').trim().toLowerCase();
      if (nlBtCol === -1 && hd.indexOf('billing') !== -1 && hd.indexOf('type') !== -1) nlBtCol = h;
      if (nlCcCol === -1 && hd.indexOf('client') !== -1 && hd.indexOf('code') !== -1) nlCcCol = h;
    }
    if (nlBtCol === -1) nlBtCol = 33; // AH fallback
    if (nlCcCol === -1) nlCcCol = 1;  // B fallback

    const map = {};
    for (const row of nlRows) {
      const cn = _normKey(row[0]); // A = container (normalized)
      if (!cn || map[cn]) continue; // first match
      map[cn] = {
        bt: String(row[nlBtCol] || '').trim(),
        cc: String(row[nlCcCol] || '').trim()
      };
    }

    /* 2. Deployed sheet — Client Code (P) + Billing Type (Q) cols detect */
    const { headers: dpHeaders, rows: dpRows } = await getSheetData(SHEETS.DEPLOYED);
    if (!dpRows.length) return 'No data in Deployed sheet.';
    let dpBtCol = -1, dpCcCol = -1;
    for (let h2 = 0; h2 < dpHeaders.length; h2++) {
      const hd2 = String(dpHeaders[h2] || '').trim().toLowerCase();
      if (dpBtCol === -1 && hd2.indexOf('billing') !== -1 && hd2.indexOf('type') !== -1) dpBtCol = h2;
      if (dpCcCol === -1 && hd2.indexOf('client') !== -1 && hd2.indexOf('code') !== -1) dpCcCol = h2;
    }
    if (dpBtCol === -1) dpBtCol = 16; // Q fallback
    if (dpCcCol === -1) dpCcCol = 15; // P fallback

    const n = dpRows.length;
    let btFilled = 0, ccFilled = 0, notFound = 0;
    const btOut = [], ccOut = [];
    for (let i = 0; i < n; i++) {
      const raw = String(dpRows[i][0] || '').trim();
      let bt = dpRows[i][dpBtCol] != null ? dpRows[i][dpBtCol] : '';
      let cc = dpRows[i][dpCcCol] != null ? dpRows[i][dpCcCol] : '';
      if (raw) {
        const parts = _splitContainers(raw);
        let hit = null;
        for (const part of parts) {
          const key = _normKey(part);
          if (key && map[key]) { hit = map[key]; break; }
        }
        if (!hit) { notFound++; }
        else {
          if (hit.bt) { bt = hit.bt; btFilled++; }
          if (hit.cc) { cc = hit.cc; ccFilled++; }
        }
      }
      btOut.push(bt);
      ccOut.push(cc);
    }
    await batchUpdateValues([
      { range: `'${SHEETS.DEPLOYED}'!${colLetter(dpBtCol)}2:${colLetter(dpBtCol)}${n + 1}`, values: btOut.map((v) => [v]) },
      { range: `'${SHEETS.DEPLOYED}'!${colLetter(dpCcCol)}2:${colLetter(dpCcCol)}${n + 1}`, values: ccOut.map((v) => [v]) }
    ]);
    return `BillingType ${btFilled} | ClientCode ${ccFilled} | Not found ${notFound}`;
  });
}

/* =============================================
   ADVANCE / END INVOICE GENERATION -> "Operation sheet"   LMS.js 1965-2117
============================================= */
export async function generateAdvanceInvoice() {
  return generateInvoiceByType('Advance');
}

export async function generateEndInvoice() {
  return generateInvoiceByType('End');
}

function fmtDDMMYYYY(d) {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

/** Parses a Deployed-sheet date cell to a JS Date, or null.
 * DEVIATION: the original read `row[6]`/`row[7]` as native Apps Script Date
 * objects straight off the sheet. The Sheets REST API returns dates as
 * formatted strings instead (see googleSheets.service.js), so parseDate()
 * (which already understands this app's DD/MM/YYYY-style formats) is tried
 * first, falling back to the JS Date constructor exactly as the original did
 * for whatever wasn't already a Date. */
function toDateOrNull(val) {
  const p = parseDate(val);
  if (p) return p;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export async function generateInvoiceByType(billingType) {
  const { rows: data } = await getSheetData(SHEETS.DEPLOYED);

  const controlVals = await getRange(SHEETS.CONTROL, 'B1:B2');
  const month = controlVals?.[0]?.[0];
  const year = controlVals?.[1]?.[0];

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const daysInMonth = endDate.getDate();

  /* ★ FIX (kept from original): wantMode is lower-cased, so it must be compared
     against lower-case "advance"/"end". */
  const wantMode = String(billingType).toLowerCase();

  /* ★ DUPLICATE GUARD — a container already billed for this exact
     month/year in "Operation sheet" is skipped. */
  const { rows: opRows } = await getSheetData(SHEETS.OPERATION);
  const billedKeys = {};
  for (const row of opRows) {
    billedKeys[`${_normKey(row[0])}|${row[21]}|${row[22]}`] = true;
  }

  const output = [];
  for (const row of data) {
    // Column Q (row[16]) — Billing Type ("Advance" / "End")
    const billingMode = String(row[16] || '').toLowerCase().trim();
    if (!billingMode.includes(wantMode)) continue;

    const deployedDate = toDateOrNull(row[6]);  // G
    const agreementDate = toDateOrNull(row[7]); // H
    if (!deployedDate || !agreementDate) continue;

    // overlap condition
    if (deployedDate > endDate || agreementDate < startDate) continue;

    const rate = Number(row[13]) || 0;   // N
    const cycle = String(row[14] || '').toLowerCase().trim(); // O

    // actual billing period
    const actualStart = deployedDate > startDate ? deployedDate : startDate;
    const actualEnd = agreementDate < endDate ? agreementDate : endDate;
    const billingDays = Math.floor((actualEnd - actualStart) / (1000 * 60 * 60 * 24)) + 1;
    const billingRange = `${fmtDDMMYYYY(actualStart)} to ${fmtDDMMYYYY(actualEnd)}`;

    // amount calculation
    let amount = 0;
    if (cycle.includes('daily')) {
      amount = billingDays * rate;
    } else if (cycle.includes('month')) {
      const perDay = rate / daysInMonth;
      amount = perDay * billingDays;
    } else if (cycle.includes('quarter')) {
      amount = (rate / 3 / daysInMonth) * billingDays;
    } else if (cycle.includes('year')) {
      amount = (rate / 12 / daysInMonth) * billingDays;
    } else {
      continue;
    }

    // ★ DUPLICATE GUARD — skip if this container already has a row for this month/year
    const dupKey = `${_normKey(row[0])}|${month}|${year}`;
    if (billedKeys[dupKey]) continue;
    billedKeys[dupKey] = true;

    // final row mapping
    const newRow = [
      row[0], '',
      row[1], '', '',
      1,
      row[13],
      row[11],
      row[9],
      row[4],
      row[2],
      row[3],
      fmtDDMMYYYY(deployedDate),
      fmtDDMMYYYY(agreementDate),
      row[8],
      row[10],
      row[12],
      row[14],
      billingDays,
      billingRange,
      amount,
      month,
      year
    ];
    output.push(newRow);
  }

  // Naya data neeche add hoga (delete nahi hoga)
  if (output.length > 0) {
    await appendRows(SHEETS.OPERATION, output);
  }

  return { inserted: output.length };
}
