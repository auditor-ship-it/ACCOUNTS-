/**
 * Shared helpers ported from LMS!.html, used identically by both the Billing
 * Sales and Pending Billing pages (each called the same original functions).
 */

/* Port of _isRateOrAmountHeader (LMS!.html ~5229) — no pricing is shown in
 * these workflow grids (Approve, Lease Expiry, Billing, Receivables,
 * Off-Lease, Reports); matches any header containing one of these
 * substrings, case-insensitive. */
const RATE_KEYWORDS = ['rate', 'amount', 'value', 'price', 'cost', 'rent', 'billed', 'received', 'outstanding', 'charge', 'deposit', 'freight'];

export function isRateOrAmountHeader(h) {
  const hl = String(h == null ? '' : h).toLowerCase();
  return RATE_KEYWORDS.some((kw) => hl.indexOf(kw) !== -1);
}

/** Indices of headers to actually display (rate/amount columns dropped). */
export function visibleHeaderIndexes(headers) {
  return headers.map((h, i) => i).filter((i) => !isRateOrAmountHeader(headers[i]));
}

/* Port of filterArr (LMS!.html ~5255) — case-insensitive substring search
 * across the first 8 cells of each row. */
export function filterRows(items, term) {
  if (!term) return items;
  const t = term.toLowerCase();
  return items.filter((r) => {
    const cells = r.row || r;
    const lim = Math.min(cells.length, 8);
    for (let i = 0; i < lim; i++) {
      if (String(cells[i] == null ? '' : cells[i]).toLowerCase().indexOf(t) !== -1) return true;
    }
    return false;
  });
}

/* Port of validateFile (LMS!.html ~8909). FileUpload only hands back
 * {base64Data, mimeType, fileName} (no raw File/size), so size is estimated
 * from the base64 payload length (~3/4 of its char length = decoded bytes),
 * which is accurate enough for this 10MB ceiling check. */
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'xls', 'xlsx'];
const MAX_BYTES = 10 * 1024 * 1024;

export function validateUpload({ fileName, base64Data }) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) === -1) return { valid: false, msg: 'Only PDF, Images, and Excel files allowed' };
  const approxBytes = Math.ceil((base64Data || '').length * 0.75);
  if (approxBytes > MAX_BYTES) return { valid: false, msg: 'File too large. Max 10MB.' };
  return { valid: true, ext };
}
