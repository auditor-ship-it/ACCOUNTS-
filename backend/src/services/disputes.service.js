/**
 * Port of LMS.js lines 5570-5805 (Receivables dispute workflow + Dispute
 * Approval queue): saveDispute, setMultiUrlCell, getDisputeApprovalData,
 * saveDisputeApprovalAction.
 *
 * NOT PORTED HERE (by design — see report to caller): onDisputeAll,
 * onDisputeSingle, onDisputeCat (LMS.js 5570-5588). Those three are pure
 * CLIENT-side UI dispatch functions — they read/write browser globals that
 * only exist in the old frontend (`recvViewMode`, `lastRecvRes`,
 * `receivablesData`, `receivablesCategoryCache`, `currentRecvType`) and call
 * `openDisputeModal(...)` / `showToast(...)`, which are frontend functions
 * with no server-side equivalent. Their entire job is: figure out which
 * container row(s) the user clicked dispute on, then call saveDispute(mode,
 * identifiers, ...). There is nothing here to run on a Node backend — the
 * new frontend is responsible for gathering `identifiers` (and `mode`/
 * `source`) itself before calling POST /api/disputes/save. Folding their
 * logic "into how the controller calls saveDispute" isn't applicable either,
 * since the controller has no access to the browser's in-memory table state
 * that these functions read from.
 *
 * IDENTITY NOTE (matches billing.service.js / receivables.service.js
 * convention): every checkActionPermission('receivables', arguments[...])
 * call in the original actually reads ONE MORE argument than the function's
 * declared parameter list — the Apps Script client always appended its own
 * auth token as a trailing arg beyond the named params. That hidden trailing
 * arg is `callerEmail` below (sourced from req.user.email via the route/
 * controller), kept separate from any explicit `userEmail` business
 * parameter that the original also writes into a sheet cell (which stays a
 * request-body field, per this migration's convention).
 *
 * DATE-WRITE NOTE (matches verify.service.js): the original wrote raw
 * `new Date(timestamp)` objects into dispute-date / approved-date cells.
 * There is no typed-Date write over the Sheets values API here, so those
 * become `safeStr(new Date(timestamp))` text ("dd/MM/yyyy"), written with
 * valueInputOption USER_ENTERED so Sheets still recognizes them as dates.
 *
 * DATE-READ NOTE: N/A for saveDispute/saveDisputeApprovalAction (write-only
 * paths). getDisputeApprovalData only reads text/number cells, not dates.
 *
 * DEAD CODE NOTE: the original computed `logDate` / `logDetail` /
 * `logAttachStr` (LMS.js 5620-5628) but never passed them to
 * writeDisputeLog or anywhere else — readDisputeLog/writeDisputeLog
 * (disputeLog.service.js) have zero call sites anywhere in LMS.js (verified
 * by search), and this function is no exception. Those variables are
 * therefore NOT reproduced here; nothing depends on them and doing so would
 * just be inert code.
 *
 * FORMATTING NOTE: the original bolds/shades the Dispute Approval header row
 * on creation (setFontWeight/setBackground). googleSheets.service.js's
 * insertSheetIfMissing() only writes values, not cell formatting, so that
 * cosmetic step is dropped here (same simplification already made by every
 * other sheet-creating function ported so far in this codebase).
 */
import { getSheetData, updateRange, batchUpdateValues, appendRows, insertSheetIfMissing, colLetter } from './googleSheets.service.js';
import { safeStr } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { checkActionPermission } from './permissions.service.js';
import { AppError } from '../utils/AppError.js';
import { SHEETS } from '../config/sheets.config.js';

const DISPUTE_APPROVAL_HEADERS = [
  'Container', 'Client Code', 'Client Name', 'Size', 'Type', 'Location',
  'Month', 'Year', 'Amount', 'Dispute Type', 'Remarks', 'Dispute Date',
  'Status', 'Approved By', 'Approved Date',
  'Period', 'Client Email', 'Sitaram Conf', 'Sitaram Approval', 'CN Required', 'Pushpa Email'
];

/** True "last column" — max(header width, widest data row) — matches Apps Script's getLastColumn(),
 *  which is not simply the header row's width if some data row extends further right. */
function lastColOf(headers, rows) {
  let n = headers.length;
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

/* =============================================
   saveDispute — LMS.js 5589-5703
============================================= */
export async function saveDispute(mode, identifiers, source, dispType, otherDesc, remarks, periodDate, attachUrls, timestamp, userEmail, callerEmail) {
  await checkActionPermission('receivables', callerEmail);

  let sheetName;
  if (mode === 'lease') sheetName = SHEETS.RECEIVABLES;
  else if (source === 'Transportion') sheetName = SHEETS.TRANSPORTION;
  else sheetName = SHEETS.RECEIVABLE_CATEGORY;

  return withSheetLock(sheetName, async () => {
    let headers, rows;
    try {
      ({ headers, rows } = await getSheetData(sheetName));
    } catch (e) {
      throw new AppError('Source sheet not found');
    }

    const srcLr = rows.length + 1; // 1-based last row (header = row 1)
    const srcLc = lastColOf(headers, rows);

    const colMap = {};
    for (let h = 0; h < headers.length; h++) {
      const hdr = String(headers[h] || '').trim().toLowerCase();
      if (hdr === 'dispute status') colMap.st = h;
      else if (hdr === 'dispute type') colMap.dt = h;
      else if (hdr === 'dispute other') colMap.do = h;
      else if (hdr === 'dispute remarks') colMap.dr = h;
      else if (hdr === 'dispute date') colMap.dd = h;
      else if (hdr === 'dispute user') colMap.du = h;
    }
    const newHeaders = [];
    if (colMap.st === undefined) { colMap.st = srcLc + newHeaders.length; newHeaders.push('Dispute Status'); }
    if (colMap.dt === undefined) { colMap.dt = srcLc + newHeaders.length; newHeaders.push('Dispute Type'); }
    if (colMap.do === undefined) { colMap.do = srcLc + newHeaders.length; newHeaders.push('Dispute Other'); }
    if (colMap.dr === undefined) { colMap.dr = srcLc + newHeaders.length; newHeaders.push('Dispute Remarks'); }
    if (colMap.dd === undefined) { colMap.dd = srcLc + newHeaders.length; newHeaders.push('Dispute Date'); }
    if (colMap.du === undefined) { colMap.du = srcLc + newHeaders.length; newHeaders.push('Dispute User'); }
    if (newHeaders.length > 0) {
      await updateRange(sheetName, `${colLetter(srcLc)}1:${colLetter(srcLc + newHeaders.length - 1)}1`, [newHeaders]);
    }

    // Dispute Approval — create with headers if missing (no call yet: only if we end up saving something).
    await insertSheetIfMissing(SHEETS.DISPUTE_APPROVAL, DISPUTE_APPROVAL_HEADERS);

    // Amount column — dynamic header search, default J (index 9), same for both branches.
    let amtCol = -1;
    for (let ah = 0; ah < headers.length; ah++) {
      if (String(headers[ah] || '').toLowerCase().indexOf('amount') !== -1) { amtCol = ah; break; }
    }
    if (amtCol === -1) amtCol = 9;

    const cellUpdates = [];
    const newDisputeRows = [];
    let saved = 0;
    const disputeDateStr = safeStr(new Date(timestamp));

    for (let i = 0; i < identifiers.length; i++) {
      let rn = -1;
      let containerNo = '', clientCode = '', clientName = '', size = '', type = '', location = '', month = '', year = '', amount = 0;

      if (mode === 'lease') {
        for (let j = 0; j < rows.length; j++) {
          if (rows[j][0] == identifiers[i]) { rn = j + 2; break; } // eslint-disable-line eqeqeq
        }
        if (rn > 0) {
          const rv = rows[rn - 2];
          containerNo = safeStr(rv[0]);
          clientCode = safeStr(rv[1]);
          clientName = safeStr(rv[2]);
          size = safeStr(rv[5]);
          type = safeStr(rv[6]);
          location = safeStr(rv[8]);
          month = safeStr(rv[12]);
          year = safeStr(rv[13]);
          amount = typeof rv[amtCol] === 'number' ? Math.ceil(rv[amtCol]) : 0;
        }
      } else {
        rn = parseInt(identifiers[i], 10);
        if (rn >= 2 && rn <= srcLr) {
          const rv = rows[rn - 2] || [];
          containerNo = safeStr(rv[0]); clientCode = safeStr(rv[1]); clientName = safeStr(rv[2]);
          size = safeStr(rv[3]); type = safeStr(rv[4]); location = safeStr(rv[5]);
          month = safeStr(rv[10]); year = safeStr(rv[11]);
          amount = typeof rv[amtCol] === 'number' ? Math.ceil(rv[amtCol]) : 0;
        }
      }

      if (rn < 2 || rn > srcLr || !containerNo) continue;

      const curStatus = colMap.st >= 0 ? (rows[rn - 2] || [])[colMap.st] : null;
      if (curStatus && String(curStatus).trim() !== '') continue; // already disputed

      if (colMap.st >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.st)}${rn}`, values: [['Disputed']] });
      if (colMap.dt >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.dt)}${rn}`, values: [[dispType || '']] });
      if (colMap.do >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.do)}${rn}`, values: [[otherDesc || '']] });
      if (colMap.dr >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.dr)}${rn}`, values: [[remarks || '']] });
      if (colMap.dd >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.dd)}${rn}`, values: [[disputeDateStr]] });
      if (colMap.du >= 0) cellUpdates.push({ range: `'${sheetName}'!${colLetter(colMap.du)}${rn}`, values: [[userEmail || '']] });

      newDisputeRows.push([
        containerNo, clientCode, clientName, size, type, location, month, year, amount,
        dispType || '', remarks || '', disputeDateStr, 'Pending', '', '',
        periodDate || '',
        (attachUrls && attachUrls.clientEmail) || '',
        (attachUrls && attachUrls.sitaramConf) || '',
        (attachUrls && attachUrls.sitaramApproval) || '',
        (attachUrls && attachUrls.cnRequired) || '',
        (attachUrls && attachUrls.pushpaEmail) || ''
      ]);
      saved++;
    }

    if (saved === 0) throw new AppError('No valid rows found');

    if (cellUpdates.length > 0) await batchUpdateValues(cellUpdates);
    if (newDisputeRows.length > 0) await appendRows(SHEETS.DISPUTE_APPROVAL, newDisputeRows);

    return `Dispute raised for ${saved} container(s)`;
  });
}

/* =============================================
   setMultiUrlCell — LMS.js 5707-5712
   DEAD CODE: zero call sites anywhere in LMS.js (verified by search) — this
   was a Range-based one-liner ("rng.setValue(urlText); skip if blank") that
   was apparently written for future use and never wired up. Ported here in
   the closest Node-appropriate shape (sheetName + A1 cell ref instead of a
   live Range object, since the REST API has no Range concept) purely for
   parity with the assignment; it is NOT wired to any route because the
   original never called it either.
============================================= */
export async function setMultiUrlCell(sheetName, a1Cell, urlText) {
  if (!urlText || String(urlText).trim() === '') return;
  await updateRange(sheetName, `${a1Cell}:${a1Cell}`, [[urlText]]);
}

/* =============================================
   getDisputeApprovalData — LMS.js 5714-5753
============================================= */
export async function getDisputeApprovalData() {
  await insertSheetIfMissing(SHEETS.DISPUTE_APPROVAL, DISPUTE_APPROVAL_HEADERS);

  const { headers, rows } = await getSheetData(SHEETS.DISPUTE_APPROVAL);
  if (!rows.length) return { headers: [], data: [], pending: 0, counts: {} };

  // Fixed 21-column width, same as the original's sheet.getRange(1,1,1,21).
  const displayHeaders = Array.from({ length: 21 }, (_, ci) => headers[ci]);
  const dh = displayHeaders.map((h) => safeStr(h));

  const data = [];
  let pending = 0;
  const counts = { operation: 0, invoice: 0, other: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).trim() === '') continue;

    const st = String(row[12] || '').trim().toLowerCase();
    if (st !== 'pending') continue; // only PENDING rows are surfaced

    data.push({ row: Array.from({ length: 21 }, (_, ci) => safeStr(row[ci])), _rowNum: i + 2 });

    const dt = String(row[9] || '').trim().toLowerCase();
    if (st === 'pending') pending++;
    if (dt === 'operation dispute') counts.operation++;
    else if (dt === 'invoice bill dispute') counts.invoice++;
    else if (dt === 'other specify') counts.other++;
  }
  return { headers: dh, data, pending, counts };
}

/* =============================================
   saveDisputeApprovalAction — LMS.js 5755-5805
============================================= */
function pad2(n) { return String(n).padStart(2, '0'); }
/** "dd-MM-yyyy HH:mm", server-local time — matches Utilities.formatDate(..., "dd-MM-yyyy HH:mm"). */
function fmtDMYHM(d) {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export async function saveDisputeApprovalAction(rowNum, status, userEmail, callerEmail) {
  await checkActionPermission('receivables', callerEmail);
  return withSheetLock(SHEETS.DISPUTE_APPROVAL, async () => {
    if (!rowNum || isNaN(rowNum)) throw new AppError('Invalid row reference');

    const { headers, rows } = await getSheetData(SHEETS.DISPUTE_APPROVAL);
    if (!rows.length) throw new AppError('No dispute records found');

    const rn = parseInt(rowNum, 10);
    const lc = lastColOf(headers, rows);

    let statusCol = -1, timestampCol = -1, userCol = -1, remarkCol = -1;
    for (let h = 0; h < headers.length; h++) {
      const hdr = String(headers[h] || '').trim().toLowerCase();
      if (hdr === 'status') statusCol = h;
      else if (hdr === 'approved by') userCol = h;
      else if (hdr === 'approved date') timestampCol = h;
      else if (hdr.indexOf('remark') !== -1 && hdr.indexOf('dispute') !== -1) remarkCol = h;
    }

    if (statusCol < 0) throw new AppError('Status column not found in sheet. Check headers.');
    if (timestampCol < 0) timestampCol = statusCol + 1;
    if (userCol < 0) userCol = timestampCol + 1;
    /* ★ PRESERVED QUIRK: on the actual Dispute Approval header set, no header
       contains both "remark" and "dispute" (the sheet's own "Remarks" column
       doesn't say "dispute", and "Dispute Type"/"Dispute Date" don't say
       "remark"), so remarkCol never matches above and always falls through
       to this `lc - 1` fallback — which for the 21-column layout lands on
       "Pushpa Email" (index 20), NOT an actual remarks column. This is a
       latent bug in the original that this port intentionally reproduces
       rather than "fixing", per the faithful-migration mandate. */
    if (remarkCol < 0) remarkCol = lc - 1;

    /* ★ PRESERVED QUIRK: the original has NO row-bounds validation here
       (unlike sendBackToBilling/transferToPendingBilling, which do check).
       An out-of-range rn just reads back blank cells (curStatus falsy) and
       proceeds to write — which in Apps Script silently expands the sheet
       to include that row; the Sheets values API does the same. Not
       reproducing a bounds check the original never had. */
    const curStatus = (rows[rn - 2] || [])[statusCol];
    const curStatusLower = curStatus ? String(curStatus).trim().toLowerCase() : '';
    if (curStatusLower === 'approved' || curStatusLower === 'rejected') {
      return 'ALREADY_PROCESSED';
    }

    const updates = [
      { range: `'${SHEETS.DISPUTE_APPROVAL}'!${colLetter(statusCol)}${rn}`, values: [[status || '']] }
    ];
    if (timestampCol >= 0) updates.push({ range: `'${SHEETS.DISPUTE_APPROVAL}'!${colLetter(timestampCol)}${rn}`, values: [[safeStr(new Date())]] });
    if (userCol >= 0) updates.push({ range: `'${SHEETS.DISPUTE_APPROVAL}'!${colLetter(userCol)}${rn}`, values: [[userEmail || '']] });

    if (status && status.toLowerCase() === 'rejected' && remarkCol >= 0) {
      const remarkText = `Rejected on ${fmtDMYHM(new Date())} by ${userEmail || 'unknown'}`;
      updates.push({ range: `'${SHEETS.DISPUTE_APPROVAL}'!${colLetter(remarkCol)}${rn}`, values: [[remarkText]] });
    }

    await batchUpdateValues(updates);
    console.log(`[DISPUTE-APPROVAL] Saved: rn=${rn} status=${status} user=${userEmail}`);
    return 'OK';
  });
}
