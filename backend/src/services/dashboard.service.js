/**
 * Port of LMS.js lines 3530-3760, 3763-4105 (Dashboard + Reports Suite +
 * Deployed Summary/Detail): getDashboardData, clearDashboardCache,
 * _reportHeader, getReportSuiteData, getMonthlyReportData,
 * normalizeContainerType, getDeployedSummaryData, getDeployedDetailData.
 *
 * DATE HANDLING: googleSheets.service.js reads values with
 * dateTimeRenderOption 'FORMATTED_STRING', so date-typed sheet cells arrive
 * as locale-formatted strings, not JS Date objects. Every place the original
 * did `cell instanceof Date` is ported here as `parseDate(cell)` (truthy if
 * parseable) instead.
 *
 * CROSS-MODULE DEPENDENCY: the original's getReportSuiteData() also calls
 * getOffLeaseApprovalData() and getOffLeaseData(1) (LMS.js lines 6563,
 * 7395) — both outside this porting slice and not yet ported anywhere in
 * this backend. Exactly like the original's own try/catch around those
 * calls ("safe, sheet na mile to 0"), this port dynamically imports
 * './offLease.service.js' and falls back to 0 if that module (or the
 * expected export) doesn't exist yet. Once another slice ports those
 * functions into services/offLease.service.js exporting
 * getOffLeaseApprovalData/getOffLeaseData, this will pick them up with no
 * changes needed here.
 */
import { getSheetDataFromMongo as getSheetData } from './mongoSheetData.service.js';
import { SHEETS } from '../config/sheets.config.js';
import { safeStr, parseDate } from '../utils/format.js';
import { cacheGet, cachePut, cacheRemove } from '../utils/memoryCache.js';
import { normalizeMonth } from './receivablesCategory.service.js';

const DASH_CACHE_KEY = 'dash_v1';
const DASH_CACHE_TTL = 60; // seconds — matches original's 60s CacheService TTL

function normKey(s) {
  return (s == null ? '' : s).toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/* =============================================================
   DASHBOARD
============================================================= */
export async function getDashboardData() {
  const hit = cacheGet(DASH_CACHE_KEY);
  if (hit) return hit;

  const result = {
    pendingVerify: 0, pendingApprovals: 0, expiring7: 0, expiring30: 0, expired: 0,
    totalRenewed: 0, pendingInvoices: 0,
    totalReceivable: 0, totalPayments: 0, totalReceived: 0, totalBilled: 0,
    ageing: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
    expiryBreakdown: { expired: 0, critical: 0, safe: 0 },
    monthlyData: [], consolidated: [], collectionRate: 0, documentsPending: 0
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ---- New Lease: pendingVerify ----
  try {
    const { rows } = await getSheetData(SHEETS.NEW_LEASE);
    for (const row of rows) {
      if (row[0] && String(row[0]).trim() !== '') {
        if (!row[26] || String(row[26]).trim() === '') result.pendingVerify++;
      }
    }
  } catch (e) { /* Dashboard verify */ }

  // ---- Operation sheet: pendingApprovals ----
  try {
    const { rows } = await getSheetData(SHEETS.OPERATION);
    // set of fresh New Lease (not Moved) — only these are manual-pending (rest auto-approve)
    let nlSet = {}, nlOk = false;
    try {
      const nl = await getSheetData(SHEETS.NEW_LEASE);
      for (const row of nl.rows) {
        const cc = String(row[0] || '').trim();
        if (cc && String(row[29] || '').trim().toLowerCase() !== 'moved') nlSet[cc] = true;
      }
      nlOk = true;
    } catch (e2) { nlOk = false; }
    for (const row of rows) {
      if (row[0] && String(row[0]).trim() !== '') {
        if (String(row[29] || '').trim().toLowerCase() === 'approved') continue;
        const cn2 = String(row[0]).trim();
        let fresh = false;
        const prts = cn2.split(/[\s,;]+/);
        for (const p of prts) { if (nlSet[p.trim()]) { fresh = true; break; } }
        if (nlOk && !fresh) continue; // this will auto-approve -> don't count as pending
        result.pendingApprovals++;
      }
    }
  } catch (e) { /* Dashboard approve */ }

  // ---- Deployed sheet: expiry buckets ----
  try {
    const { headers, rows } = await getSheetData(SHEETS.DEPLOYED);
    let validIdx = -1;
    for (let h = 0; h <= 14 && h < headers.length; h++) {
      if (headers[h] && String(headers[h]).toLowerCase().indexOf('valid') !== -1) { validIdx = h; break; }
    }
    for (const row of rows) {
      if (!row[0] || String(row[0]).trim() === '') continue;
      const wVal = String(row[22] || '').trim().toLowerCase();
      if (wVal === 'renewed') { result.totalRenewed++; continue; }
      // off-lease stages removed
      if (wVal === 'documents pending') { result.documentsPending++; continue; }
      if (row[21] && String(row[21]).trim() !== '') continue;
      if (validIdx >= 0) {
        const vd = parseDate(row[validIdx]);
        if (vd) {
          const days = Math.ceil((vd - today) / 86400000);
          if (days <= 0) result.expired++;
          else if (days <= 7) result.expiring7++;
          else if (days <= 30) result.expiring30++;
        }
      }
    }
    result.expiryBreakdown = { expired: result.expired, critical: result.expiring7, safe: result.expiring30 };
  } catch (e) { /* Dashboard expiry */ }

  // ---- Billing Sales: pendingInvoices ----
  try {
    const { rows } = await getSheetData(SHEETS.BILLING_SALES);
    for (const row of rows) {
      if (row[0] && String(row[0]).trim() !== '') {
        // same as getBillingData: invoice (AE,30) filled -> billed -> don't count;
        // transfer pending (AF,31) -> don't count; only AB(27)-empty ones are pending
        if (row[30] && String(row[30]).trim() !== '') continue;
        if (row[31] && String(row[31]).trim().toLowerCase() === 'pending') continue;
        if (!row[27] || String(row[27]).trim() === '') result.pendingInvoices++;
      }
    }
  } catch (e) { /* Dashboard billing */ }

  /* ===== RECEIVABLES BLOCK ===== */
  try {
    const { rows } = await getSheetData(SHEETS.RECEIVABLES);
    const monthMap = {};
    const monthOrder = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

    // Same duplicate guard as getReceivablesLeaseData — otherwise the dashboard
    // Total Billed / Outstanding will not match the Receivables tab.
    const seenDash = {};

    for (const row of rows) {
      if (!row[0] || String(row[0]).trim() === '') continue;

      const month = normalizeMonth(row[12]); // M(12) = Month
      const year = safeStr(row[13]);          // N(13) = Year

      const dk = `${normKey(row[0])}|${month}|${year}`;
      if (seenDash[dk]) continue; // duplicate row -> count it only once
      seenDash[dk] = true;

      const key = `${month}|${year}`;
      if (!monthMap[key]) {
        monthMap[key] = {
          month, year, billed: 0, received: 0, containers: 0,
          ageing030: 0, ageing3160: 0, ageing6190: 0, ageing90plus: 0
        };
      }

      const numAmt = typeof row[9] === 'number' ? row[9] : 0;   // J = Total Bill Amount
      const numRec = typeof row[28] === 'number' ? row[28] : 0; // AC = Received Amount

      monthMap[key].billed += numAmt;
      monthMap[key].received += numRec;
      monthMap[key].containers++;
      result.totalBilled += numAmt;
      result.totalReceived += numRec;

      // Y(24) = Payment Receive — check if paid
      const isPaid = row[24] && String(row[24]).trim() !== '';

      if (isPaid) {
        result.totalPayments++;
      } else {
        const outstanding = numAmt - numRec;
        if (outstanding > 0) {
          result.totalReceivable += outstanding;

          let band = '90+';
          const bd = parseDate(row[14]); // O(14) = Actual (Billing Date)
          if (bd) {
            const days = Math.ceil((today - bd) / 86400000);
            if (days <= 30) band = '0-30';
            else if (days <= 60) band = '31-60';
            else if (days <= 90) band = '61-90';
          }

          if (band === '0-30') { result.ageing['0-30'] += outstanding; monthMap[key].ageing030 += outstanding; }
          else if (band === '31-60') { result.ageing['31-60'] += outstanding; monthMap[key].ageing3160 += outstanding; }
          else if (band === '61-90') { result.ageing['61-90'] += outstanding; monthMap[key].ageing6190 += outstanding; }
          else { result.ageing['90+'] += outstanding; monthMap[key].ageing90plus += outstanding; }
        }
      }
    }

    const keys = Object.keys(monthMap).sort((a, b) => {
      const pA = a.split('|'), pB = b.split('|');
      const yd = parseInt(pA[1], 10) - parseInt(pB[1], 10);
      return yd !== 0 ? yd : (monthOrder[pA[0]] || 0) - (monthOrder[pB[0]] || 0);
    });
    for (const k of keys) {
      const m = monthMap[k];
      result.monthlyData.push({ label: `${m.month} ${m.year}`, billed: m.billed, received: m.received });
      result.consolidated.push(m);
    }
    result.collectionRate = result.totalBilled > 0 ? Math.round((result.totalReceived / result.totalBilled) * 100) : 0;
  } catch (e) { /* Dashboard receivables */ }
  /* ===== END RECEIVABLES BLOCK ===== */

  cachePut(DASH_CACHE_KEY, result, DASH_CACHE_TTL); // 60s cache
  return result;
}

/** Clear dashboard cache — call after any write action so fresh data is fetched. */
export function clearDashboardCache() {
  cacheRemove(DASH_CACHE_KEY);
  cacheRemove('mytasks_v1'); // keep My Task in sync after any write action
}

/* =============================================================
   REPORTS SUITE — 10 standard reports (MIS / CFO / CEO)
   Set config here. Data that isn't reliably available in the sheets
   (SLA target order-date, EBITDA, cash forecast) stays "" (blank)
   -> shows as "—" in the UI (not a fake number).
============================================================= */
const REPORT_META = {
  company: 'Crystal Group',
  currency: 'INR',
  version: 'V1.0',
  region: 'All',
  slaTargetDays: 7 // Deployment SLA target (days). If an order-date column is available, SLA will be computed.
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatGeneratedOn(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = MONTH_ABBR[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mmm}-${yyyy} ${hh}:${mi}`;
}

/** userEmail replaces the original's getCurrentUser(token) — identity comes from req.user.email at the call site. */
export function _reportHeader(name, period, userEmail) {
  return {
    company: REPORT_META.company,
    reportName: name,
    period: period || 'All',
    generatedOn: formatGeneratedOn(new Date()),
    generatedBy: userEmail || 'unknown',
    region: REPORT_META.region,
    currency: REPORT_META.currency,
    version: REPORT_META.version
  };
}

async function safeOffLeaseApprovalCount() {
  try {
    // NOTE: filename is lowercase 'offlease.service.js' (matches the actual
    // ported module) — was './offLease.service.js' (capital L), which only
    // worked by accident on case-insensitive filesystems (Windows/default
    // macOS) and would 404 on case-sensitive Linux prod.
    const mod = await import('./offlease.service.js');
    if (typeof mod.getOffLeaseApprovalData !== 'function') return 0;
    const olr = await mod.getOffLeaseApprovalData();
    return (olr && olr.count) || (olr && olr.data ? olr.data.length : 0) || 0;
  } catch (e) { return 0; }
}

async function safeOffLeaseOpenCount() {
  try {
    const mod = await import('./offlease.service.js');
    if (typeof mod.getOffLeaseData !== 'function') return 0;
    const s1 = await mod.getOffLeaseData(1);
    return (s1 && s1.data ? s1.data.length : 0);
  } catch (e) { return 0; }
}

/* All reports' data in one call. Reuses getDashboardData() (60s cache -> fast). */
export async function getReportSuiteData(userEmail) {
  let d = {};
  try { d = (await getDashboardData()) || {}; } catch (e) { d = {}; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageing = d.ageing || { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const consolidated = d.consolidated || [];

  /* ---- Deployed sheet: active contracts + expiry buckets (ek read) ---- */
  let activeContracts = 0, exp30 = 0, exp60 = 0, exp90 = 0;
  try {
    const { headers, rows } = await getSheetData(SHEETS.DEPLOYED);
    let vIdx = -1;
    for (let h = 0; h < 15 && h < headers.length; h++) {
      if (String(headers[h] || '').toLowerCase().indexOf('valid') !== -1) { vIdx = h; break; }
    }
    for (const row of rows) {
      if (!row[0] || String(row[0]).trim() === '') continue;
      const stt = String(row[22] || '').toLowerCase();
      if (stt.indexOf('off-lease') !== -1) continue; // off-leased -> not active
      activeContracts++;
      if (vIdx >= 0) {
        const vd = parseDate(row[vIdx]);
        if (vd) {
          const days = Math.ceil((vd - today) / 86400000);
          if (days >= 0 && days <= 30) exp30++;
          if (days >= 0 && days <= 60) exp60++;
          if (days >= 0 && days <= 90) exp90++;
        }
      }
    }
  } catch (e) { /* noop */ }

  /* ---- Off-Lease status counts (safe, sheet na mile to 0) ---- */
  const olApprovalPending = await safeOffLeaseApprovalCount();
  const olOpen = await safeOffLeaseOpenCount();
  const olCompleted = ''; // never computed in the original either

  /* ---- AR aging FINER buckets (0-30,31-60,61-90,91-180,180+) — ek receivables read ---- */
  const arFine = [
    { label: '0-30 Days', amount: 0, count: 0 },
    { label: '31-60 Days', amount: 0, count: 0 },
    { label: '61-90 Days', amount: 0, count: 0 },
    { label: '91-180 Days', amount: 0, count: 0 },
    { label: '180+ Days', amount: 0, count: 0 }
  ];
  try {
    const { rows } = await getSheetData(SHEETS.RECEIVABLES);
    for (const row of rows) {
      if (!row[0] || String(row[0]).trim() === '') continue;
      if (row[24] && String(row[24]).trim() !== '') continue; // Y(24)=paid -> skip
      const amt = typeof row[9] === 'number' ? row[9] : 0;    // J(9)=amount
      const rec = typeof row[28] === 'number' ? row[28] : 0;  // AC(28)=received
      const out = amt - rec;
      if (out <= 0) continue;
      let dys = 999999;
      const bd = parseDate(row[14]);
      if (bd) dys = Math.ceil((today - bd) / 86400000); // O(14)=billing date
      const bi = dys <= 30 ? 0 : dys <= 60 ? 1 : dys <= 90 ? 2 : dys <= 180 ? 3 : 4;
      arFine[bi].amount += out; arFine[bi].count++;
    }
  } catch (e) { /* noop */ }

  /* ---- Derived KPIs ---- */
  const totalBilled = d.totalBilled || 0, totalReceived = d.totalReceived || 0, totalReceivable = d.totalReceivable || 0;
  const collection = d.collectionRate || 0;
  const months = consolidated.length || 0;
  const dso = totalBilled > 0 ? Math.round((totalReceivable / totalBilled) * (months > 0 ? months * 30 : 30)) : '';
  let growth = '';
  if (consolidated.length >= 2) {
    const lastB = consolidated[consolidated.length - 1].billed || 0;
    const prevB = consolidated[consolidated.length - 2].billed || 0;
    if (prevB > 0) growth = Math.round(((lastB - prevB) / prevB) * 100);
  }
  const expired = d.expired || 0, renewed = d.totalRenewed || 0;
  const renewalRate = (renewed + expired) > 0 ? Math.round((renewed / (renewed + expired)) * 100) : '';
  const overdue90 = ageing['90+'] || 0;
  const pctOverdue = totalReceivable > 0 ? (overdue90 / totalReceivable) * 100 : 0;
  /* Health score (INDEX, formula-based — not a real financial metric like EBITDA): collection 40% + (100-overdue%) 30% + renewal 30% */
  let health = Math.round((collection * 0.4) + ((100 - pctOverdue) * 0.3) + ((renewalRate === '' ? 0 : renewalRate) * 0.3));
  if (health < 0) health = 0; if (health > 100) health = 100;

  /* Monthly rows (collection efficiency + revenue) */
  const monthRows = consolidated.map((m) => {
    const out = (m.billed || 0) - (m.received || 0);
    const pct = m.billed > 0 ? Math.round((m.received / m.billed) * 100) : 0;
    return { month: `${m.month} ${m.year}`, containers: m.containers || 0, billed: m.billed || 0, received: m.received || 0, outstanding: out, collection: pct };
  });

  /* ---- AUTO BUSINESS INSIGHTS (analysis help) ---- */
  const insights = [];
  const ins = (level, text) => insights.push({ level, text });
  const inr = (x) => `₹${Math.round(x || 0).toLocaleString('en-IN')}`;
  if (collection >= 80) ins('good', `Collection efficiency is strong (${collection}%). Cash flow is healthy.`);
  else if (collection >= 50) ins('warn', `Collection efficiency is ${collection}% — increase follow-ups to reach the 80%+ target.`);
  else ins('bad', `Collection efficiency is only ${collection}% — an urgent recovery drive is needed.`);
  if (totalReceivable > 0) {
    const p90 = Math.round((overdue90 / totalReceivable) * 100);
    if (p90 >= 25) ins('bad', `${inr(overdue90)} (${p90}% of receivables) is stuck over 90 days — high risk, act immediately.`);
    else if (p90 >= 10) ins('warn', `${p90}% of receivables is over 90 days old (${inr(overdue90)}) — prioritise recovery.`);
    else ins('good', `90+ day receivables are under control (${p90}%).`);
  }
  if (expired > 0) ins('bad', `${expired} lease(s) have already EXPIRED — decide renew or off-lease immediately (revenue leakage).`);
  if (exp30 > 0) ins('warn', `${exp30} lease(s) expire within 30 days — activate the renewal pipeline.`);
  const np = (d.pendingVerify || 0) + (d.pendingApprovals || 0);
  if (np > 0) ins('warn', `${np} new lease order(s) pending (verify/approve) — process soon to avoid deployment delays.`);
  if ((d.pendingInvoices || 0) > 0) ins('warn', `${d.pendingInvoices} invoice(s) not yet generated — complete billing to recognise revenue.`);
  if (dso !== '' && dso > 60) ins('warn', `DSO is ~${dso} days — payment cycle is long, review credit terms.`);
  else if (dso !== '' && dso <= 45 && dso > 0) ins('good', `DSO is ~${dso} days — healthy payment cycle.`);
  if (growth !== '') { if (growth > 0) ins('good', `Revenue grew ${growth}% vs last month — positive momentum.`); else if (growth < 0) ins('bad', `Revenue fell ${Math.abs(growth)}% vs last month — analyse the cause.`); }
  if (renewalRate !== '' && renewalRate < 50 && (renewed + expired) > 0) ins('warn', `Renewal rate is ${renewalRate}% — retention needs improvement.`);
  if (!insights.length) ins('good', 'All metrics are within the normal range.');

  return {
    meta: REPORT_META,
    generatedOn: formatGeneratedOn(new Date()),
    generatedBy: userEmail || 'unknown',
    insights,
    arAgingFine: arFine,

    newLeasePending: { count: (d.pendingVerify || 0) + (d.pendingApprovals || 0), verify: d.pendingVerify || 0, approve: d.pendingApprovals || 0, value: '' },
    deploymentSla: { deployed: activeContracts, withinSla: '', breached: '', compliance: '', note: 'To compute SLA, provide an Order-Date column and set slaTargetDays in REPORT_META.' },
    billingException: { totalInvoices: '', exceptions: d.pendingInvoices || 0, exceptionValue: '', note: 'Exception = pending / ungenerated invoices.' },
    arAging: { total: totalReceivable, b0: ageing['0-30'] || 0, b1: ageing['31-60'] || 0, b2: ageing['61-90'] || 0, b3: overdue90 },
    collectionEff: { months: monthRows, totalBilled, totalReceived, totalOutstanding: totalReceivable, collection },
    revenue: { total: totalBilled, months: monthRows, lease: '', renewal: '', offlease: '' },
    renewalPipeline: { exp30, exp60, exp90, expired, renewed, renewalRate },
    offLease: { open: olOpen, approvalPending: olApprovalPending, pickupPending: '', completed: olCompleted },
    cfo: { revenue: totalBilled, outstanding: totalReceivable, collection, dso, revenueAtRisk: overdue90, cashForecast30: '' },
    ceo: { activeContracts, revenue: totalBilled, growth, renewalRate, collection, overdue90, ebitda: '', health }
  };
}

/* The Report tab used to call getMonthlyReportData() (which was missing) — alias so the old call doesn't break */
export async function getMonthlyReportData(userEmail) {
  return getReportSuiteData(userEmail);
}

export function normalizeContainerType(rawType) {
  if (!rawType) return 'Other';
  const t = rawType.toString().trim().toLowerCase();
  if (t.indexOf('refer') !== -1) return 'Refer';
  if (t.indexOf('dry') !== -1) return 'Dry';
  if (t.indexOf('iso') !== -1 || t.indexOf('tank') !== -1) return 'ISO TANK';
  return rawType.toString().trim();
}

export async function getDeployedSummaryData() {
  const { rows } = await getSheetData(SHEETS.DEPLOYED);
  if (!rows.length) return { months: [], types: [], sizes: [], typeSizes: {}, rows: [] };

  const containers = [];
  let minDate = null;
  const typeSet = {}, sizeSet = {}, typeSizeSet = {};

  for (const row of rows) {
    if (!row[0] || String(row[0]).trim() === '') continue;

    const deployDate = parseDate(row[6]); // G = Deployed Date
    if (!deployDate) continue;

    const actionTimestamp = parseDate(row[21]); // V = Action Timestamp
    const actionStatus = safeStr(row[22]).toLowerCase(); // W = Action Status

    const type = normalizeContainerType(row[3]); // D = Type
    const size = safeStr(row[2]).trim() || 'Unknown'; // C = Size

    containers.push({
      deployDate,
      offLeaseDate: (actionStatus === 'off-lease' && actionTimestamp) ? actionTimestamp : null,
      type, size
    });
    typeSet[type] = true;
    sizeSet[size] = true;
    if (!typeSizeSet[type]) typeSizeSet[type] = {};
    typeSizeSet[type][size] = true;
    if (!minDate || deployDate < minDate) minDate = new Date(deployDate);
  }

  if (containers.length === 0 || !minDate) return { months: [], types: [], sizes: [], typeSizes: {}, rows: [] };

  const typePriority = ['Refer', 'Dry', 'ISO TANK'];
  let types = [];
  for (const tp of typePriority) if (typeSet[tp]) types.push(tp);
  types = types.concat(Object.keys(typeSet).filter((t) => typePriority.indexOf(t) === -1).sort());
  const sizes = Object.keys(sizeSet).sort();
  const typeSizes = {};
  for (const t of types) typeSizes[t] = typeSizeSet[t] ? Object.keys(typeSizeSet[t]).sort() : [];

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = [];
  let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const endBound = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  while (cursor < endBound) {
    months.push({
      label: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`,
      start: new Date(cursor.getTime()),
      end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  months.reverse();
  if (months.length === 0) return { months: [], types, sizes, typeSizes, rows: [] };

  function emptyStat() {
    const s = { total: 0 };
    for (const t of types) s[t] = 0;
    return s;
  }
  function emptyTsMap() {
    const map = {};
    for (const t of types) {
      map[t] = { total: 0 };
      const szArr = typeSizes[t] || [];
      for (const sz of szArr) map[t][sz] = 0;
    }
    return map;
  }

  const summaryRows = [];
  for (const mObj of months) {
    const ms = mObj.start.getTime(), me = mObj.end.getTime();
    const opening = emptyStat(), addition = emptyStat(), deletion = emptyStat();
    const openingTs = emptyTsMap(), additionTs = emptyTsMap(), deletionTs = emptyTsMap();

    for (const ct of containers) {
      const dt = ct.deployDate.getTime();
      const ot = ct.offLeaseDate ? ct.offLeaseDate.getTime() : null;

      if (dt < ms && (ot === null || ot >= ms)) {
        opening.total++; opening[ct.type] = (opening[ct.type] || 0) + 1;
        openingTs[ct.type].total++; openingTs[ct.type][ct.size] = (openingTs[ct.type][ct.size] || 0) + 1;
      }
      if (dt >= ms && dt < me) {
        addition.total++; addition[ct.type] = (addition[ct.type] || 0) + 1;
        additionTs[ct.type].total++; additionTs[ct.type][ct.size] = (additionTs[ct.type][ct.size] || 0) + 1;
      }
      if (ot !== null && ot >= ms && ot < me) {
        deletion.total++; deletion[ct.type] = (deletion[ct.type] || 0) + 1;
        deletionTs[ct.type].total++; deletionTs[ct.type][ct.size] = (deletionTs[ct.type][ct.size] || 0) + 1;
      }
    }

    const net = { total: addition.total - deletion.total }, netTs = emptyTsMap();
    const closing = { total: opening.total + net.total }, closingTs = emptyTsMap();
    for (const tn of types) {
      net[tn] = (addition[tn] || 0) - (deletion[tn] || 0);
      netTs[tn].total = net[tn];
      closing[tn] = (opening[tn] || 0) + net[tn];
      closingTs[tn].total = closing[tn];
      const szArr = typeSizes[tn] || [];
      for (const sz of szArr) {
        netTs[tn][sz] = (additionTs[tn][sz] || 0) - (deletionTs[tn][sz] || 0);
        closingTs[tn][sz] = (openingTs[tn][sz] || 0) + (netTs[tn][sz] || 0);
      }
    }

    summaryRows.push({
      month: mObj.label,
      opening, addition, deletion,
      net, closing,
      _sz: { opening: openingTs, addition: additionTs, deletion: deletionTs, net: netTs, closing: closingTs }
    });
  }

  return { months: months.map((m) => m.label), types, sizes, typeSizes, rows: summaryRows };
}

export async function getDeployedDetailData(monthLabel, category, typeFilter, sizeFilter) {
  const parts = monthLabel.trim().split(' ');
  const monthStr = parts[0], year = parseInt(parts[1], 10);
  const monthOrder = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const monthNum = monthOrder[monthStr];
  if (monthNum === undefined) return { containers: [] };
  const monthStart = new Date(year, monthNum, 1), monthEnd = new Date(year, monthNum + 1, 1);
  const ms = monthStart.getTime(), me = monthEnd.getTime();

  const { rows } = await getSheetData(SHEETS.DEPLOYED);
  if (!rows.length) return { containers: [] };

  const cleanType = typeFilter ? normalizeContainerType(typeFilter).toLowerCase() : '';
  const cleanSize = sizeFilter ? sizeFilter.toLowerCase().trim() : '';
  const containers = [];

  for (const row of rows) {
    if (!row[0] || String(row[0]).trim() === '') continue;
    const deployDate = parseDate(row[6]); // G = Deployed Date
    if (!deployDate) continue;

    const dt = deployDate.getTime();
    const actionTs = parseDate(row[21]); // V = Action Timestamp
    const actionSt = safeStr(row[22]).toLowerCase(); // W = Action Status
    const ot = (actionSt === 'off-lease' && actionTs) ? actionTs.getTime() : null;

    // D(3) = Type, C(2) = Size
    if (cleanType && normalizeContainerType(row[3]).toLowerCase() !== cleanType) continue;
    if (cleanSize && safeStr(row[2]).trim().toLowerCase() !== cleanSize) continue;

    let include = false, movement = '';
    if (category === 'opening') { include = (dt < ms && (ot === null || ot >= ms)); movement = 'Existing'; }
    else if (category === 'addition') { include = (dt >= ms && dt < me); movement = 'Addition'; }
    else if (category === 'deletion') { include = (ot !== null && ot >= ms && ot < me); movement = 'Deletion'; }
    else if (category === 'closing') { include = (dt < me && (ot === null || ot >= me)); movement = 'Existing'; }
    else if (category === 'net') {
      if (dt >= ms && dt < me) { include = true; movement = 'Addition'; }
      else if (ot !== null && ot >= ms && ot < me) { include = true; movement = 'Deletion'; }
    }
    if (!include) continue;

    containers.push({
      container: safeStr(row[0]),   // A = Container
      clientCode: safeStr(row[15]),  // P = Client Code
      clientName: safeStr(row[1]),   // B = Client Name
      size: safeStr(row[2]),         // C = Size
      type: safeStr(row[3]),         // D = Type
      location: safeStr(row[4]),     // E = Location
      deployedDate: safeStr(row[6]), // G = Deployed Date
      validUpto: safeStr(row[7]),    // H = Valid Upto
      rate: typeof row[13] === 'number' ? row[13] : 0, // N = Rate
      movement,
      offLeaseDate: movement === 'Deletion' ? safeStr(row[21]) : '' // V = Action TS
    });
  }

  return { containers };
}
