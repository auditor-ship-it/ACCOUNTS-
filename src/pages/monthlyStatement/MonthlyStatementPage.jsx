import { Fragment, useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getStatementPivotData } from '../../api/statement.api.js';
import { formatAmt } from '../../utils/format.js';
import styles from './MonthlyStatementPage.module.css';

/**
 * Monthly Statement — port of initStatement()/renderStatementPivot()
 * (LMS!.html 5913-6048): a container × month pivot (Billed / Received per
 * month, plus a Grand Total / Outstanding column), no month/year/view-by
 * selector — the only control is the search box. Backend RPC is
 * getStatementPivotData() (receivablesCategory.service.js, wired at
 * GET /api/category/statement-pivot — confirmed by reading category.routes.js
 * directly; NOT receivables.routes.js's similarly-named /monthly-statement,
 * which this page does not call — see statement.api.js's dead-code note).
 *
 * Response shape (confirmed from getStatementPivotData()):
 *   { months: string[] ("Mon YYYY", chronological), containers: [{
 *       container, clientCode, clientName, months: { [monthKey]: { billed, received } }
 *     }], totalBilled, totalReceived, totalOutstanding, collectionRate }
 * KPIs and the Grand Total row are recomputed client-side from the
 * currently-filtered container set (matching the original, which recomputes
 * monthTotals/totalBilled/totalReceived on every search keystroke rather than
 * using the unfiltered top-level totals).
 */
export function MonthlyStatementPage() {
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useAsync(() => getStatementPivotData(), []);

  const months = data?.months || [];
  const allContainers = data?.containers || [];

  const containers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allContainers;
    return allContainers.filter((c) => (
      c.container.toLowerCase().includes(term) ||
      c.clientName.toLowerCase().includes(term) ||
      c.clientCode.toLowerCase().includes(term)
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allContainers, search]);

  const { monthTotals, totalBilled, totalReceived, totalOutstanding, collectionRate } = useMemo(() => {
    const mt = {};
    for (const m of months) mt[m] = { billed: 0, received: 0 };
    let tb = 0, tr = 0;
    for (const c of containers) {
      for (const m of months) {
        const md = c.months[m] || { billed: 0, received: 0 };
        tb += md.billed; tr += md.received;
        mt[m].billed += md.billed; mt[m].received += md.received;
      }
    }
    const to = tb - tr;
    return { monthTotals: mt, totalBilled: tb, totalReceived: tr, totalOutstanding: to, collectionRate: tb > 0 ? Math.round((tr / tb) * 100) : 0 };
  }, [containers, months]);

  return (
    <>
      <PageHeader
        title="Monthly Statement"
        subtitle="Container-wise monthly billed vs. received pivot"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className={styles.ctrlBar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search Container, Client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search statement"
        />
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !allContainers.length ? (
          <EmptyState message="No statement data found" hint="Add entries in Receivables sheet" />
        ) : (
          <>
            <div className={styles.kpiRow}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Billed</span>
                <span className={styles.kpiValueBlue}>{formatAmt(totalBilled)}</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Received</span>
                <span className={styles.kpiValueGreen}>{formatAmt(totalReceived)}</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Outstanding</span>
                <span className={styles.kpiValueRed}>{formatAmt(totalOutstanding)}</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Collection Rate</span>
                <span className={styles.kpiValue}>{collectionRate}%</span>
              </div>
            </div>

            {!containers.length ? (
              <EmptyState message="No records match your search" />
            ) : (
              <>
                <div className={styles.sectionTitle}>
                  Container-wise Monthly Statement · {containers.length} Containers · {months.length} Months
                </div>
                <div className={styles.scrollWrap}>
                  <table className={styles.pivotTable}>
                    <thead>
                      <tr>
                        <th rowSpan={2} className={styles.stickyLeft}>Container No.</th>
                        <th rowSpan={2} className={styles.stickyLeft2}>Client Name</th>
                        {months.map((m) => <th key={m} colSpan={2} className={styles.monthHead}>{m}</th>)}
                        <th colSpan={2} className={styles.totalHead}>GRAND TOTAL</th>
                        <th rowSpan={2} className={styles.totalHead}>Outstanding</th>
                      </tr>
                      <tr>
                        {months.map((m) => (
                          <Fragment key={m}>
                            <th className={styles.subHeadBilled}>Billed</th>
                            <th className={styles.subHeadReceived}>Received</th>
                          </Fragment>
                        ))}
                        <th className={`${styles.subHeadBilled} ${styles.totalHead}`}>Billed</th>
                        <th className={`${styles.subHeadReceived} ${styles.totalHead}`}>Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {containers.map((c) => {
                        let rowBilled = 0, rowReceived = 0;
                        for (const m of months) {
                          const md = c.months[m] || { billed: 0, received: 0 };
                          rowBilled += md.billed; rowReceived += md.received;
                        }
                        const rowOut = rowBilled - rowReceived;
                        return (
                          <tr key={c.container}>
                            <td className={`${styles.stickyLeft} ${styles.containerCell}`}>{c.container}</td>
                            <td className={styles.stickyLeft2}>{c.clientName}</td>
                            {months.map((m) => {
                              const md = c.months[m] || { billed: 0, received: 0 };
                              return (
                                <Fragment key={m}>
                                  <td className={styles.amtBilled}>{md.billed > 0 ? formatAmt(md.billed) : <span className={styles.dash}>-</span>}</td>
                                  <td className={styles.amtReceived}>{md.received > 0 ? formatAmt(md.received) : <span className={styles.dash}>-</span>}</td>
                                </Fragment>
                              );
                            })}
                            <td className={`${styles.amtBilled} ${styles.totalCol}`}>{formatAmt(rowBilled)}</td>
                            <td className={`${styles.amtReceived} ${styles.totalCol}`}>{formatAmt(rowReceived)}</td>
                            <td className={rowOut > 0 ? styles.amtOutstanding : rowOut === 0 ? styles.amtSettled : styles.dash}>{formatAmt(rowOut)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className={styles.grandRow}>
                        <td colSpan={2} className={styles.stickyLeft}>Grand Total</td>
                        {months.map((m) => (
                          <Fragment key={m}>
                            <td className={styles.amtBilled}>{formatAmt(monthTotals[m].billed)}</td>
                            <td className={styles.amtReceived}>{formatAmt(monthTotals[m].received)}</td>
                          </Fragment>
                        ))}
                        <td className={`${styles.amtBilled} ${styles.totalCol}`}>{formatAmt(totalBilled)}</td>
                        <td className={`${styles.amtReceived} ${styles.totalCol}`}>{formatAmt(totalReceived)}</td>
                        <td className={totalOutstanding > 0 ? styles.amtOutstanding : styles.amtSettled}>{formatAmt(totalOutstanding)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </>
  );
}
