/**
 * Port of the Billing Sales "FY dropdown + Apr–Mar month tabs" browsing bar
 * (LMS!.html ~7028-7195: BILL_MONTH_NAMES, billMonthName, computeBillCols,
 * billRowMonthYear, billMonthKey, billCountByMonth, fyOf, fyHasData,
 * buildBillingFyAndTabs). Pure client-side filter over already-fetched
 * category data — the original never re-fetches from the server when you
 * switch FY/month, it just re-filters the same cached rows, so this port
 * does the same (no backend involvement).
 */

export const BILL_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function billMonthName(v) {
  const s = v == null ? '' : String(v).trim();
  if (s === '') return '';
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 12 ? BILL_MONTH_NAMES[n - 1] : '';
  }
  const idx = MONTH_ABBR.indexOf(s.substring(0, 3).toLowerCase());
  return idx >= 0 ? BILL_MONTH_NAMES[idx] : '';
}

/** Locate the relevant columns by HEADER NAME (not fixed index) so it survives column shifts. */
export function computeBillCols(headers) {
  const map = { range: -1, month: -1, year: -1, planned: -1 };
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] == null ? '' : headers[i]).toLowerCase();
    if (map.range === -1 && h.indexOf('range') !== -1) map.range = i;
    if (map.month === -1 && h.indexOf('month') !== -1) map.month = i;
    if (map.year === -1 && h.indexOf('year') !== -1) map.year = i;
    if (map.planned === -1 && (h.indexOf('planned') !== -1 || h.indexOf('planed') !== -1)) map.planned = i;
  }
  return map;
}

/**
 * Determine a row's billing month+year. Prefer Billing Range text like
 * "01.04.2026 TO 30.04.2026", then Month + Year/Planned columns, then scan
 * the whole row for any dd.mm.yyyy-style date.
 */
export function billRowMonthYear(row, cols) {
  cols = cols || {};
  if (cols.range >= 0) {
    const m = String(row[cols.range] == null ? '' : row[cols.range]).match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);
    if (m) {
      const mi = parseInt(m[2], 10);
      if (mi >= 1 && mi <= 12) return { month: BILL_MONTH_NAMES[mi - 1], year: m[3] };
    }
  }
  let mn = cols.month >= 0 ? billMonthName(row[cols.month]) : '';
  let y = '';
  if (cols.year >= 0) {
    const ym = String(row[cols.year] == null ? '' : row[cols.year]).match(/(20\d{2})/);
    if (ym) y = ym[1];
  }
  if (!y && cols.planned >= 0) {
    const p = String(row[cols.planned] == null ? '' : row[cols.planned]).match(/(20\d{2})/);
    if (p) y = p[1];
  }
  if (!mn || !y) {
    for (let c = 0; c < row.length; c++) {
      const dm = String(row[c] == null ? '' : row[c]).match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);
      if (dm) {
        const mi2 = parseInt(dm[2], 10);
        if (mi2 >= 1 && mi2 <= 12) {
          if (!mn) mn = BILL_MONTH_NAMES[mi2 - 1];
          if (!y) y = dm[3];
          break;
        }
      }
    }
  }
  return { month: mn, year: y };
}

export function billMonthKey(row, cols) {
  const k = billRowMonthYear(row, cols);
  if (!k.month) return '';
  return k.year ? `${k.month} ${k.year}` : k.month;
}

/** Counts rows per "Mon YYYY" key. */
export function billCountByMonth(data, cols) {
  const have = {};
  for (const item of data) {
    const key = billMonthKey(item.row || item, cols);
    if (key) have[key] = (have[key] || 0) + 1;
  }
  return have;
}

/** Financial year (Apr–Mar) a given month+year belongs to, e.g. (Apr,2026)->"2026-2027", (Feb,2027)->"2026-2027". */
export function fyOf(monthName, yearStr) {
  const mi = BILL_MONTH_NAMES.indexOf(monthName);
  const y = parseInt(yearStr, 10);
  if (mi < 0 || isNaN(y)) return null;
  const sy = mi >= 3 ? y : y - 1; // Apr(index 3)–Dec -> y ; Jan–Mar -> y-1
  return `${sy}-${sy + 1}`;
}

export function fyHasData(fy, have) {
  const sy = parseInt(fy, 10);
  for (let m = 0; m < 12; m++) {
    const mi = (3 + m) % 12;
    const yr = 3 + m < 12 ? sy : sy + 1;
    if (have[`${BILL_MONTH_NAMES[mi]} ${yr}`]) return true;
  }
  return false;
}

/** The 12 "Mon YYYY" keys (Apr–Mar) for a given FY string "YYYY-YYYY+1". */
export function monthsOfFy(fy) {
  const startYear = parseInt(fy, 10);
  const tabs = [];
  for (let m = 0; m < 12; m++) {
    const mi = (3 + m) % 12;
    const yr = 3 + m < 12 ? startYear : startYear + 1;
    tabs.push(`${BILL_MONTH_NAMES[mi]} ${yr}`);
  }
  return tabs;
}

/**
 * Builds the distinct FY list present in `have` (plus always the current
 * FY), matching buildBillingFyAndTabs's FY-collection logic.
 */
export function distinctFYs(have) {
  const now = new Date();
  const curStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fySet = new Set([`${curStart}-${curStart + 1}`]);
  for (const k of Object.keys(have)) {
    const [monthName, yearStr] = k.split(' ');
    const fy = fyOf(monthName, yearStr);
    if (fy) fySet.add(fy);
  }
  return [...fySet].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/** Default FY: current FY if it has data, else latest FY that has data. */
export function defaultFy(fys, have) {
  const now = new Date();
  const curStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const curFy = `${curStart}-${curStart + 1}`;
  if (fyHasData(curFy, have)) return curFy;
  for (let f = fys.length - 1; f >= 0; f--) {
    if (fyHasData(fys[f], have)) return fys[f];
  }
  return curFy;
}

/** Default month within the selected FY: current month (if in FY & has data), else latest month with data, else first. */
export function defaultMonth(tabs, have) {
  const now = new Date();
  const curKey = `${BILL_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  let pick = tabs.indexOf(curKey) !== -1 && have[curKey] ? curKey : null;
  if (!pick) {
    for (let t = tabs.length - 1; t >= 0; t--) {
      if (have[tabs[t]]) { pick = tabs[t]; break; }
    }
  }
  if (!pick) pick = tabs.indexOf(curKey) !== -1 ? curKey : tabs[0];
  return pick;
}
