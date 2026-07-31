/**
 * Port of LMS.js lines 5472-5568 (Billing Sales "pending transfer" workflow):
 * sendBackToBilling, transferToPendingBilling, getPendingBillingData.
 *
 * All three operate on the "Billing Sales" sheet's AF (Transfer Status) /
 * AG (Transfer Date) columns — a distinct concept from the AB-AE "billed"
 * columns saveBillingAction (billing.service.js) manages, and also distinct
 * from saveBulkBillingAction's category-specific "Billing Timestamp"
 * columns (a different porting range, not touched here). sendBackToBilling
 * clears AF/AG (undoing a transfer back to the pending-billing queue);
 * transferToPendingBilling sets them ("Pending" + today's date).
 *
 * NO DEPENDENCY on saveBulkBillingAction: neither function here calls it —
 * verified by reading the actual LMS.js source in this range; both work
 * directly against Billing Sales columns AF/AG only.
 *
 * IDENTITY NOTE (same convention as billing.service.js / disputes.service.js):
 * checkActionPermission('billing', arguments[arguments.length - 1]) reads ONE
 * MORE argument than each function's declared parameter list (the Apps
 * Script client always appended its own auth token as a trailing arg beyond
 * the named params). That hidden trailing arg is `callerEmail` below,
 * sourced from req.user.email. transferToPendingBilling's declared
 * `userEmail` parameter is preserved for signature parity even though the
 * original NEVER reads it inside the function body (verified — it is a
 * genuinely dead parameter in LMS.js; AG only ever receives `new Date()`,
 * never a user identity).
 *
 * DATE-WRITE NOTE (matches verify.service.js): `new Date()` cell writes
 * become `safeStr(new Date())` text ("dd/MM/yyyy") over the values API.
 *
 * DATE-READ NOTE (matches receivablesCategory.service.js): the original's
 * `tDate instanceof Date` check (LMS.js 5560) can never be true here, since
 * googleSheets.service.js reads dates back as FORMATTED_STRING text, not
 * native Date objects. Ported as `parseDate(tDate)` truthy-check instead,
 * formatting through safeStr() (which already renders dd/MM/yyyy — same
 * format the original explicitly requested) when parseable.
 */
import { getSheetData, getRange, updateCell, updateRange } from './googleSheets.service.js';
import { safeStr, parseDate, buildDisplayRow } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { checkActionPermission } from './permissions.service.js';
import { AppError } from '../utils/AppError.js';
import { SHEETS } from '../config/sheets.config.js';

/* =============================================
   sendBackToBilling — LMS.js 5472-5486
============================================= */
export async function sendBackToBilling(rowNum, callerEmail) {
  await checkActionPermission('billing', callerEmail);
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const rn = parseInt(rowNum, 10);
    const colA = await getRange(SHEETS.BILLING_SALES, 'A2:A');
    const lastRow = colA.length + 1;
    if (rn < 2 || rn > lastRow) throw new AppError('Row out of range');

    const afCell = await getRange(SHEETS.BILLING_SALES, `AF${rn}:AF${rn}`);
    const status = afCell?.[0]?.[0];
    if (!status || String(status).trim().toLowerCase() !== 'pending') return 'NOT_IN_PENDING';

    await updateRange(SHEETS.BILLING_SALES, `AF${rn}:AG${rn}`, [['', '']]);
    return 'OK';
  });
}

/* =============================================
   transferToPendingBilling — LMS.js 5488-5516
============================================= */
export async function transferToPendingBilling(rowNum, userEmail, callerEmail) {
  await checkActionPermission('billing', callerEmail);
  return withSheetLock(SHEETS.BILLING_SALES, async () => {
    const rn = parseInt(rowNum, 10);
    const colA = await getRange(SHEETS.BILLING_SALES, 'A2:A');
    const lastRow = colA.length + 1;
    if (rn < 2 || rn > lastRow) throw new AppError('Row out of range');

    const afCell = await getRange(SHEETS.BILLING_SALES, `AF${rn}:AF${rn}`);
    const afVal = afCell?.[0]?.[0];
    if (afVal && String(afVal).trim().toLowerCase() === 'pending') return 'ALREADY_TRANSFERRED';

    // ★ Create headers if missing
    const headerCells = await getRange(SHEETS.BILLING_SALES, 'AF1:AG1');
    const af1 = headerCells?.[0]?.[0];
    const ag1 = headerCells?.[0]?.[1];
    if (!af1) await updateCell(SHEETS.BILLING_SALES, 1, 31, 'Transfer Status'); // AF (0-based col 31)
    if (!ag1) await updateCell(SHEETS.BILLING_SALES, 1, 32, 'Transfer Date');   // AG (0-based col 32)

    // ★ Write to exact columns
    await updateRange(SHEETS.BILLING_SALES, `AF${rn}:AG${rn}`, [['Pending', safeStr(new Date())]]);
    return 'OK';
  });
}

/* =============================================
   getPendingBillingData — LMS.js 5518-5568
============================================= */
export async function getPendingBillingData() {
  console.log('[PENDING-BE] Start');
  const { headers, rows } = await getSheetData(SHEETS.BILLING_SALES);
  console.log('[PENDING-BE] lastRow:', rows.length + 1);

  if (!rows.length) {
    console.log('[PENDING-BE] No data rows');
    return { headers: [], data: [] };
  }

  const lastRow = rows.length + 1;
  const displayHeaders = headers.slice(0, 22);
  while (displayHeaders.length < 22) displayHeaders.push('');

  // Ensure headers
  const headerCells = await getRange(SHEETS.BILLING_SALES, 'AF1:AG1');
  const af1 = headerCells?.[0]?.[0];
  const ag1 = headerCells?.[0]?.[1];
  console.log('[PENDING-BE] AF1:', af1, 'AG1:', ag1);
  if (!af1) await updateCell(SHEETS.BILLING_SALES, 1, 31, 'Transfer Status');
  if (!ag1) await updateCell(SHEETS.BILLING_SALES, 1, 32, 'Transfer Date');

  const afValues = await getRange(SHEETS.BILLING_SALES, `AF2:AF${lastRow}`);
  const agValues = await getRange(SHEETS.BILLING_SALES, `AG2:AG${lastRow}`);
  console.log('[PENDING-BE] AF values count:', afValues.length);

  let pendingCount = 0;
  for (let c = 0; c < afValues.length; c++) {
    if (String(afValues[c]?.[0] || '').trim().toLowerCase() === 'pending') pendingCount++;
  }
  console.log('[PENDING-BE] Pending rows found:', pendingCount);

  const finalData = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).trim() === '') continue;
    const transferStatus = String(afValues[i]?.[0] || '').trim().toLowerCase();
    if (transferStatus !== 'pending') continue;

    const tDateRaw = agValues[i]?.[0];
    const tDateParsed = parseDate(tDateRaw);
    finalData.push({
      row: buildDisplayRow(row, 22, displayHeaders),
      _rowNum: i + 2,
      transferDate: tDateParsed ? safeStr(tDateParsed) : safeStr(tDateRaw)
    });
  }

  console.log('[PENDING-BE] Returning:', finalData.length, 'records');
  return { headers: displayHeaders.map((h) => safeStr(h)), data: finalData };
}
