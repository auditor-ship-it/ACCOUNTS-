import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { Button } from '../../components/common/Button.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { apiErrorMessage } from '../../api/client.js';
import { getOutstandingPivotData } from '../../api/outstanding.api.js';
import { formatAmt } from '../../utils/format.js';
import styles from './OutstandingViewPage.module.css';

const AGEING_BANDS = [
  { key: '0-30', label: '0 - 30 Days', cls: 'safe' },
  { key: '31-60', label: '31 - 60 Days', cls: 'warning' },
  { key: '61-90', label: '61 - 90 Days', cls: 'critical' },
  { key: '90+', label: '90+ Days', cls: 'overdue' }
];

const BAND_CLASS = { '90+': 'overdue', '61-90': 'critical', '31-60': 'warning', '0-30': 'safe' };

/**
 * Outstanding View — port of setOutView()/initOutstanding()/
 * renderOutstandingPivot()/showOutDetail()/renderOutDetailImmediate()
 * (LMS!.html 6053-6247): a month-wise outstanding pivot with a Customer Wise /
 * Container Wise toggle, and a click-through drill-down panel per month cell.
 * Backend RPC is getOutstandingPivotData(viewBy) (receivablesCategory.service.js,
 * wired at GET /api/category/outstanding-pivot — confirmed by reading
 * category.routes.js directly; NOT receivables.routes.js's similarly-named
 * /outstanding-view, which this page does not call — see outstanding.api.js's
 * dead-code note).
 *
 * Response shape (confirmed from getOutstandingPivotData()):
 *   { months: string[] ("Mon YYYY", chronological), ageing: {band: amount},
 *     totalOutstanding, data: [{ label, subLabel, months: {monthKey: amount},
 *       rowTotal, rawItems: [{ container, clientCode, clientName, monthKey,
 *       billed, received, outstanding, days, band }] }] }
 * The drill-down panel (rawItems filtered to the clicked row + month) is
 * already present client-side in the response — no extra RPC needed,
 * matching the original (showOutDetail never calls the server).
 */
export function OutstandingViewPage() {
  const [viewBy, setViewBy] = useState('customer'); // 'customer' | 'container'
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null); // { row, monthKey }
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);
    getOutstandingPivotData(viewBy)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(apiErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [viewBy]);

  const months = data?.months || [];
  const allRows = data?.data || [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allRows;
    return allRows.filter((r) => r.label.toLowerCase().includes(term) || r.subLabel.toLowerCase().includes(term));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, search]);

  const { monthTotals, grandTotal } = useMemo(() => {
    const mt = {};
    for (const m of months) mt[m] = 0;
    let gt = 0;
    for (const r of rows) {
      gt += r.rowTotal;
      for (const m of months) mt[m] += r.months[m] || 0;
    }
    return { monthTotals: mt, grandTotal: gt };
  }, [rows, months]);

  const isCust = viewBy === 'customer';
  const rowLabelHeader = isCust ? 'Client Name' : 'Container No.';
  const subLabelHeader = isCust ? 'Client Code' : 'Client Name';

  function openDetail(row, monthKey) {
    setDetail({ row, monthKey });
  }

  const detailItems = detail
    ? detail.row.rawItems.filter((it) => it.monthKey === detail.monthKey)
    : [];

  return (
    <>
      <PageHeader title="Outstanding View" subtitle="Month-wise outstanding pivot, by customer or container" />

      <div className={styles.ctrlBar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search Container, Client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search outstanding"
        />
        <div className={styles.viewToggle}>
          <button type="button" className={isCust ? styles.viewToggleActive : ''} onClick={() => setViewBy('customer')}>Customer Wise</button>
          <button type="button" className={!isCust ? styles.viewToggleActive : ''} onClick={() => setViewBy('container')}>Container Wise</button>
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setViewBy((v) => v)} />
        ) : !months.length ? (
          <EmptyState message="No outstanding data found" hint="All invoices have been paid" />
        ) : (
          <>
            <div className={styles.kpiRow}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Outstanding</span>
                <span className={styles.kpiValueRed}>{formatAmt(grandTotal)}</span>
              </div>
              {AGEING_BANDS.map((b) => (
                <div key={b.key} className={`${styles.kpiCard} ${styles[b.cls]}`}>
                  <span className={styles.kpiLabel}>{b.label}</span>
                  <span className={styles.kpiValue}>{formatAmt(data?.ageing?.[b.key] || 0)}</span>
                </div>
              ))}
            </div>

            {!rows.length ? (
              <EmptyState message="No records match your search" />
            ) : (
              <>
                <div className={styles.sectionTitle}>
                  Outstanding {isCust ? 'Customer' : 'Container'}-wise · {rows.length} {isCust ? 'Customers' : 'Containers'} · {months.length} Months
                </div>
                <div className={styles.scrollWrap}>
                  <table className={styles.pivotTable}>
                    <thead>
                      <tr>
                        <th className={styles.stickyLeft}>{rowLabelHeader}</th>
                        <th className={styles.stickyLeft2}>{subLabelHeader}</th>
                        {months.map((m) => <th key={m} className={styles.monthHead}>{m}</th>)}
                        <th className={styles.totalHead}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, ri) => (
                        <tr key={ri} className={detail?.row === r ? styles.highlightRow : undefined}>
                          <td className={`${styles.stickyLeft} ${isCust ? '' : styles.containerCell}`}>{r.label}</td>
                          <td className={styles.stickyLeft2}>{r.subLabel}</td>
                          {months.map((m) => {
                            const val = r.months[m] || 0;
                            return (
                              <td key={m} className={styles.amtCell}>
                                {val > 0 ? (
                                  <button type="button" className={styles.amtBtn} onClick={() => openDetail(r, m)}>{formatAmt(val)}</button>
                                ) : <span className={styles.dash}>-</span>}
                              </td>
                            );
                          })}
                          <td className={`${styles.amtOutstanding} ${styles.totalCol}`}>{formatAmt(r.rowTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={styles.grandRow}>
                        <td colSpan={2} className={styles.stickyLeft}>Grand Total</td>
                        {months.map((m) => <td key={m} className={styles.amtCell}>{formatAmt(monthTotals[m])}</td>)}
                        <td className={`${styles.amtOutstanding} ${styles.totalCol}`}>{formatAmt(grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {detail && (
                  <OutstandingDetail
                    title={isCust ? `${detail.row.label} (${detail.row.subLabel})` : detail.row.label}
                    monthKey={detail.monthKey}
                    items={detailItems}
                    onClose={() => setDetail(null)}
                  />
                )}
              </>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function OutstandingDetail({ title, monthKey, items, onClose }) {
  const totalOut = items.reduce((s, i) => s + i.outstanding, 0);
  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailPanelHeader}>
        <div>
          <h4>{title}</h4>
          {items.length > 0 && (
            <span className={styles.detailBadge}>{monthKey} · {items.length} container(s) · Outstanding: {formatAmt(totalOut)}</span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
      {!items.length ? (
        <EmptyState message="No matching containers" />
      ) : (
        <div className={styles.detailScroll}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th>Container</th>
                <th>Client Code</th>
                <th>Client Name</th>
                <th className={styles.num}>Billed</th>
                <th className={styles.num}>Received</th>
                <th className={styles.num}>Outstanding</th>
                <th>Days</th>
                <th>Ageing</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className={styles.containerCell}>{it.container}</td>
                  <td>{it.clientCode}</td>
                  <td>{it.clientName}</td>
                  <td className={styles.num}>{formatAmt(it.billed)}</td>
                  <td className={`${styles.num} ${styles.amtReceived}`}>{formatAmt(it.received)}</td>
                  <td className={`${styles.num} ${styles.amtOutstanding}`}>{formatAmt(it.outstanding)}</td>
                  <td className={it.band ? styles[`text_${BAND_CLASS[it.band]}`] : undefined}>{it.days || '-'}</td>
                  <td>{it.band ? <span className={styles[BAND_CLASS[it.band]]}>{it.band}</span> : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className={styles.footTotalLabel}>Total</td>
                <td className={`${styles.num} ${styles.amtOutstanding}`} style={{ fontWeight: 900 }}>{formatAmt(totalOut)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
