/**
 * Port of LMS.js lines 5807-5889: saveBulkReceivablePayment.
 *
 * Applies ONE payment action across MULTIPLE Receivables rows — but per the
 * original's actual logic, this is NOT a split of `amount` across the
 * containers. Read carefully (LMS.js 5845):
 *   var payThis = newPayment > 0 ? newPayment : (invAmount - curReceived);
 * When a positive `amount` is supplied, that FULL amount is credited to
 * EVERY container in `containerNos` independently (each capped at its own
 * invoice amount, never divided by container count). Only when `amount` is
 * falsy/0 does each container instead get "pay off my own remaining
 * balance in full" (invAmount - curReceived) — again independently, not a
 * shared pool. A single optional attachment (base64Data/mimeType/fileName)
 * is uploaded ONCE and its URL appended to every processed container's
 * attachment log — the original has no per-container attachment support.
 *
 * Column layout (0-based, "Receivables" sheet) — matches the layout already
 * documented in receivables.service.js's header comment, reused verbatim
 * here since this is the same sheet:
 *   R=17 status text, Y=24 payment-receive date, AC=28 received amount,
 *   AD=29 payment attachment, AE=30/AF=31/AG=32 payment log (date/detail/user).
 *   Amount column is header-detected (first header containing "amount"
 *   within the first 33 columns), default J=9 if not found — same
 *   detection order as the original and as receivables.service.js.
 *
 * IDENTITY NOTE (matches billing.service.js / disputes.service.js /
 * pendingBilling.service.js convention): checkActionPermission('receivables',
 * arguments[arguments.length - 1]) reads ONE MORE argument than the
 * function's declared parameter list (the Apps Script client always
 * appended its own auth token as a trailing arg beyond the named params).
 * That hidden trailing arg is `callerEmail` below (from req.user.email);
 * the declared `userEmail` parameter is real business data — written into
 * the AG payment-log-user column exactly as the original does — so it stays
 * a request-body field per this migration's convention.
 *
 * DATE NOTE: `payDate` was already computed via `safeStr(new Date(timestamp))`
 * in the ORIGINAL source itself (not a Node adaptation) — ported verbatim.
 * The Y-column "payment received" date, which the original wrote as a raw
 * `new Date(timestamp)` object, is adapted to `safeStr(new Date(timestamp))`
 * text (dd/MM/yyyy) over the values API, matching the DATE-WRITE convention
 * already established in verify.service.js / disputes.service.js.
 */
import { getSheetData, batchUpdateValues } from './googleSheets.service.js';
import { safeStr } from '../utils/format.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { checkActionPermission } from './permissions.service.js';
import { AppError } from '../utils/AppError.js';
import { SHEETS } from '../config/sheets.config.js';
import { uploadToDrive } from './googleDrive.service.js';

export async function saveBulkReceivablePayment(containerNos, timestamp, amount, utr, remarks, userEmail, base64Data, mimeType, fileName, callerEmail) {
  await checkActionPermission('receivables', callerEmail);
  return withSheetLock(SHEETS.RECEIVABLES, async () => {
    if (!containerNos || containerNos.length === 0) throw new AppError('No containers provided');
    if (!utr || String(utr).trim() === '') throw new AppError('UTR / Reference is required');
    const newPayment = amount ? parseFloat(amount) : 0;

    const { headers, rows } = await getSheetData(SHEETS.RECEIVABLES);
    if (!rows.length) throw new AppError('No data rows');

    const headers33 = headers.slice(0, 33);
    let amtCol = 9;
    for (let h = 0; h < headers33.length; h++) {
      if (String(headers33[h] || '').toLowerCase().indexOf('amount') !== -1) { amtCol = h; break; }
    }

    let url = '';
    if (base64Data && String(base64Data).trim() !== '') {
      url = await uploadToDrive(base64Data, mimeType || 'application/octet-stream', fileName || `bulk_${Date.now()}.pdf`);
    }

    const updates = [];
    let saved = 0, skipped = 0;

    for (let i = 0; i < containerNos.length; i++) {
      const cn = containerNos[i];
      let targetRow = -1;
      for (let j = 0; j < rows.length; j++) {
        if (rows[j][0] == cn) { targetRow = j + 2; break; } // eslint-disable-line eqeqeq
      }
      if (targetRow === -1) { skipped++; continue; }

      const row = rows[targetRow - 2];
      const curReceived = typeof row[28] === 'number' ? row[28] : 0; // AC
      const invAmount = typeof row[amtCol] === 'number' ? row[amtCol] : 0;

      const payThis = newPayment > 0 ? newPayment : (invAmount - curReceived);
      if (payThis <= 0) { skipped++; continue; }

      let newTotal = curReceived + payThis;
      if (invAmount > 0 && newTotal > invAmount) {
        newTotal = invAmount;
      }

      updates.push({ range: `'${SHEETS.RECEIVABLES}'!AC${targetRow}`, values: [[newTotal]] });

      const payDetail = `UTR: ${utr} | ₹${payThis.toLocaleString('en-IN')}${remarks ? ` | ${remarks}` : ''}`;
      const payDate = safeStr(new Date(timestamp));

      const aeVal = row[30]; // AE
      const afVal = row[31]; // AF
      const agVal = row[32]; // AG
      if (aeVal && String(aeVal).trim() !== '') {
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!AE${targetRow}:AG${targetRow}`, values: [[`${aeVal}\n${payDate}`, `${afVal || ''}\n${payDetail}`, `${agVal || ''}\n${userEmail || ''}`]] });
      } else {
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!AE${targetRow}:AG${targetRow}`, values: [[payDate, payDetail, userEmail || '']] });
      }

      if (url) {
        const adVal = safeStr(row[29]); // AD
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!AD${targetRow}`, values: [[adVal.trim() !== '' ? `${adVal}\n${url}` : url]] });
      }

      if (newTotal >= invAmount && invAmount > 0) {
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!Y${targetRow}`, values: [[safeStr(new Date(timestamp))]] });
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!R${targetRow}`, values: [['Payment Received']] });
      } else {
        updates.push({ range: `'${SHEETS.RECEIVABLES}'!R${targetRow}`, values: [['Partial Payment']] });
      }
      saved++;
    }

    if (updates.length > 0) await batchUpdateValues(updates);

    let msg = `Payment recorded for ${saved} container(s)`;
    if (skipped > 0) msg += `. Skipped ${skipped}.`;
    return msg;
  });
}
