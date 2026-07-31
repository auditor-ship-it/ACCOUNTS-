import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { renderCellValue } from '../../components/common/CellValue.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getApprovalSummary } from '../../api/approvalSummary.api.js';
import styles from './ApprovalSummaryPage.module.css';

const FILTERS = [
  { key: 'lease', label: 'Lease Approved', accent: 'blue' },
  { key: 'category', label: 'Sale / Spare / Transport Order', accent: 'violet' },
  { key: 'billing', label: 'Billing Approved', accent: 'teal' },
  { key: 'transport', label: 'Transportation Approved', accent: 'slate' }
];

const RATE_AMOUNT_KEYWORDS = ['rate', 'amount', 'value', 'price', 'cost', 'rent', 'billed', 'received', 'outstanding', 'charge', 'deposit', 'freight'];

/** Port of _isRateOrAmountHeader (LMS!.html ~5229) — hides money columns from this read-only summary grid. */
function isRateOrAmountHeader(h) {
  const hl = String(h == null ? '' : h).toLowerCase();
  return RATE_AMOUNT_KEYWORDS.some((kw) => hl.indexOf(kw) !== -1);
}

/** Port of formatISODate (LMS!.html ~9379). */
function formatISODate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Port of filterArr (LMS!.html ~5255) — free-text search across the first 8 visible columns. */
function searchFilter(rows, term) {
  if (!term) return rows;
  const t = term.toLowerCase();
  const lim = 8;
  return rows.filter((row) => {
    const n = Math.min(row.length, lim);
    for (let i = 0; i < n; i++) {
      if (String(row[i] == null ? '' : row[i]).toLowerCase().indexOf(t) !== -1) return true;
    }
    return false;
  });
}

/** Port of filterByDateRange (LMS!.html ~9388). */
function dateRangeFilter(rows, dateColIdx, fromVal, toVal) {
  if (!fromVal && !toVal) return rows;
  const from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const to = toVal ? new Date(toVal + 'T23:59:59') : null;
  return rows.filter((row) => {
    const raw = row[dateColIdx];
    if (!raw) return false;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

export function ApprovalSummaryPage() {
  const { data, loading, error, reload } = useAsync(getApprovalSummary, []);
  const [activeFilter, setActiveFilter] = useState('lease');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const counts = useMemo(() => {
    const c = { lease: 0, category: 0, billing: 0, transport: 0 };
    if (data) {
      for (const key of Object.keys(c)) c[key] = data[key]?.data?.length || 0;
    }
    return c;
  }, [data]);
  const grandTotal = counts.lease + counts.category + counts.billing + counts.transport;

  const cache = data ? data[activeFilter] : null;

  const { visibleCols, dateColIdx, filtered, searched } = useMemo(() => {
    if (!cache || !cache.headers || cache.headers.length === 0) {
      return { visibleCols: [], dateColIdx: -1, filtered: [], searched: [] };
    }
    const dIdx = cache.headers.length - 2;
    const vCols = [];
    for (let i = 0; i < cache.headers.length; i++) if (!isRateOrAmountHeader(cache.headers[i])) vCols.push(i);
    const s = searchFilter(cache.data, search.trim());
    const f = dateRangeFilter(s, dIdx, dateFrom, dateTo);
    return { visibleCols: vCols, dateColIdx: dIdx, filtered: f, searched: s };
  }, [cache, search, dateFrom, dateTo]);

  if (loading) {
    return (<><PageHeader title="Approval Summary" subtitle="Already-approved records across Lease, Category & Billing" /><Card><LoadingSpinner label="Loading approval history..." /></Card></>);
  }
  if (error) {
    return (<><PageHeader title="Approval Summary" subtitle="Already-approved records across Lease, Category & Billing" /><Card><ErrorState message={error} onRetry={reload} /></Card></>);
  }

  const hasDateFilter = !!(dateFrom || dateTo);
  const hiddenCount = searched.length - filtered.length;
  const colspanBeforeDate = visibleCols.filter((c) => c < dateColIdx).length;

  return (
    <>
      <PageHeader
        title="Approval Summary"
        subtitle="Already-approved records across Lease, Category & Billing"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className={styles.kpiGrid}>
        <div className={`${styles.kpiCard} ${styles.tintNavy}`}>
          <div className={styles.kpiLabel}>Lease Approved</div>
          <div className={styles.kpiValue}>{counts.lease}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintInfo}`}>
          <div className={styles.kpiLabel}>Sale / Spare / Transport</div>
          <div className={styles.kpiValue}>{counts.category}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintSuccess}`}>
          <div className={styles.kpiLabel}>Billing Approved</div>
          <div className={styles.kpiValue}>{counts.billing}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintNeutral}`}>
          <div className={styles.kpiLabel}>Transportation Approved</div>
          <div className={styles.kpiValue}>{counts.transport}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintNavy}`}>
          <div className={styles.kpiLabel}>Grand Total</div>
          <div className={styles.kpiValue}>{grandTotal}</div>
        </div>
      </div>

      <div className={styles.subTabs}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.subTab} ${activeFilter === f.key ? styles.subTabActive : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor="asSearch">Search</label>
          <input id="asSearch" className={styles.searchInput} type="text" placeholder="Search records..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="asDateFrom">From</label>
          <input id="asDateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="asDateTo">To</label>
          <input id="asDateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {(dateFrom || dateTo) && (
          <button type="button" className={styles.clearBtn} onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear Dates</button>
        )}
      </div>

      {!cache || !cache.headers || cache.headers.length === 0 ? (
        <Card><EmptyState message="No approved records found" hint="Approved records from Lease, Category & Billing will appear here" /></Card>
      ) : (
        <>
          {hasDateFilter && (
            <div className={styles.dateInfo}>
              <Icon name="calendar" size="sm" /> Filtered by {dateFrom || '...'} to {dateTo || '...'} — Showing {filtered.length} of {searched.length}
              {hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
            </div>
          )}

          <div className={styles.sectionTitle}>{cache.sectionTitle || 'Records'} &middot; {filtered.length} Found</div>

          <div className={styles.tableWrap}>
            <table className={styles.asTable}>
              <thead>
                <tr>
                  {visibleCols.map((c) => (
                    <th key={c} className={c === dateColIdx ? styles.dateCol : c === dateColIdx + 1 ? styles.userCol : ''}>
                      {cache.headers[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={visibleCols.length} style={{ textAlign: 'center', padding: 50, color: 'var(--text-3)' }}>No records match your filter</td></tr>
                ) : (
                  filtered.map((row, ri) => (
                    <tr key={ri}>
                      {visibleCols.map((c) => {
                        const isDate = c === dateColIdx;
                        const isUser = c === dateColIdx + 1;
                        const val = isDate ? formatISODate(row[c]) : renderCellValue(row[c]);
                        return (
                          <td key={c} className={isDate ? styles.dateCol : isUser ? styles.userCol : ''} title={String(row[c] ?? '')}>
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className={styles.tfoot}>
                  <td colSpan={colspanBeforeDate} style={{ textAlign: 'right' }}>Total Records</td>
                  <td className={styles.dateCol}>{filtered.length}</td>
                  <td className={styles.userCol}>&mdash;</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}
