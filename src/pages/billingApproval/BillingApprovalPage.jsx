import { useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { Button } from '../../components/common/Button.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { StatusBadge } from '../../components/common/StatusBadge.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { usePermission } from '../../hooks/usePermission.js';
import { useToast } from '../../context/ToastContext.jsx';
import { apiErrorMessage } from '../../api/client.js';
import * as billingApprovalApi from '../../api/billingApproval.api.js';
import styles from './BillingApprovalPage.module.css';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOW = new Date();
// Matches populateMonthSelectors() in the original: curYear-2 .. curYear+1.
const YEAR_OPTIONS = [NOW.getFullYear() - 2, NOW.getFullYear() - 1, NOW.getFullYear(), NOW.getFullYear() + 1];

/**
 * Monthly Billing Approval — port of LMS!.html's initBillingApproval /
 * fetchBillingApproval / renderBillingApproval / approveCustBilling /
 * approveSingleBilling (~6262-6312). One card per client, listing every
 * container billed that month with its approval status; "Approve All"
 * bulk-approves the client's still-pending rows, "Approve" approves a single
 * container. Neither action had a confirm() step in the original, so neither
 * gets a ConfirmDialog here.
 */
export function BillingApprovalPage() {
  const [month, setMonth] = useState(MONTH_NAMES[NOW.getMonth()]);
  const [year, setYear] = useState(String(NOW.getFullYear()));
  const { canAct } = usePermission();
  // approveMonthlyBilling's actual checkActionPermission call in
  // receivables.service.js is ('receivables', ...), not 'billing' — gate on
  // that so the button's visibility matches what the server will allow.
  const canApprove = canAct('receivables');
  const showToast = useToast();

  const { data, loading, error, reload } = useAsync(
    () => billingApprovalApi.getMonthlyBillingApprovalData(month, year),
    [month, year]
  );

  const [busyClient, setBusyClient] = useState('');
  const [busyContainer, setBusyContainer] = useState('');

  const approveClient = async (clientCode) => {
    setBusyClient(clientCode);
    try {
      const res = await billingApprovalApi.approveMonthlyBilling('', month, year, clientCode);
      showToast(res.message);
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setBusyClient('');
    }
  };

  const approveContainer = async (container) => {
    setBusyContainer(container);
    try {
      const res = await billingApprovalApi.approveMonthlyBilling(container, month, year, '');
      if (res.message === 'ALREADY_PROCESSED') showToast('Already approved by another user', 'info');
      else showToast(res.message);
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setBusyContainer('');
    }
  };

  const totalPending = data?.totalPending || 0;
  const totalContainers = data?.totalContainers || 0;
  const showEmpty = !data || totalPending === 0;

  return (
    <>
      <PageHeader
        title="Billing Approval"
        subtitle="Monthly billing per client, pending sign-off before invoicing"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <Card>
        <div className={styles.monthCtrl}>
          <label htmlFor="baMonth">Month</label>
          <select id="baMonth" value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTH_NAMES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label htmlFor="baYear">Year</label>
          <select id="baYear" value={year} onChange={(e) => setYear(e.target.value)}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {loading && <LoadingSpinner label="Loading billing for approval" />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && showEmpty && (
          <EmptyState message="No pending billing for selected month" hint="All billing has been approved" />
        )}

        {!loading && !error && !showEmpty && (
          <>
            <div className={styles.kpiRow}>
              <div className={`${styles.kpiCard} ${styles.safe}`}>
                <span className={styles.kpiLabel}>Total Containers</span>
                <span className={styles.kpiValue}>{totalContainers}</span>
              </div>
              <div className={`${styles.kpiCard} ${styles.critical}`}>
                <span className={styles.kpiLabel}>Pending Approval</span>
                <span className={styles.kpiValue}>{totalPending}</span>
              </div>
              <div className={`${styles.kpiCard} ${styles.overdue}`}>
                <span className={styles.kpiLabel}>Already Approved</span>
                <span className={styles.kpiValue}>{totalContainers - totalPending}</span>
              </div>
            </div>

            {(data.data || []).map((cust) => (
              <div key={cust.clientCode} className={styles.custCard}>
                <div className={styles.custHeader}>
                  <div>
                    <h4>{cust.clientName}</h4>
                    <span className={styles.custCode}>{cust.clientCode} &middot; {cust.containers.length} Containers</span>
                  </div>
                  {cust.pendingCount > 0 && canApprove && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busyClient === cust.clientCode}
                      disabled={!!busyClient || !!busyContainer}
                      onClick={() => approveClient(cust.clientCode)}
                    >
                      Approve All ({cust.pendingCount})
                    </Button>
                  )}
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.custTable}>
                    <thead>
                      <tr>
                        <th>Container</th><th>Size</th><th>Type</th><th>Location</th><th>Cycle</th><th>Status</th><th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cust.containers.map((c) => {
                        const isPending = c.status === 'Pending';
                        return (
                          <tr key={c.container}>
                            <td className={styles.containerCell}>{c.container}</td>
                            <td>{c.size}</td>
                            <td>{c.type}</td>
                            <td>{c.location}</td>
                            <td>{c.cycle}</td>
                            <td><StatusBadge status={isPending ? 'Pending' : 'Approved'} /></td>
                            <td>
                              {isPending ? (
                                canApprove ? (
                                  <Button
                                    variant="accent"
                                    size="sm"
                                    loading={busyContainer === c.container}
                                    disabled={!!busyClient || !!busyContainer}
                                    onClick={() => approveContainer(c.container)}
                                  >
                                    Approve
                                  </Button>
                                ) : <span className={styles.viewOnly}>View only</span>
                              ) : <span className={styles.dash}>-</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>
    </>
  );
}
