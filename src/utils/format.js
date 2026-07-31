/**
 * Port of formatAmt() (LMS!.html ~5250): rupee-formatted, rounded UP to the
 * nearest whole rupee, grouped with the en-IN digit grouping (e.g. ₹1,23,456).
 * Non-numeric input is returned as-is (stringified), matching the original's
 * `esc(n)` fallback.
 */
export function formatAmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return n == null ? '' : String(n);
  return '₹' + Math.ceil(n).toLocaleString('en-IN');
}
