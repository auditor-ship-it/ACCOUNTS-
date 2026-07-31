import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { Button } from '../../components/common/Button.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { StatusBadge } from '../../components/common/StatusBadge.jsx';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { renderCellValue } from '../../components/common/CellValue.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { usePermission } from '../../hooks/usePermission.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiErrorMessage } from '../../api/client.js';
import * as disputesApi from '../../api/disputes.api.js';
import { isRateOrAmountHeader, filterRows } from '../../utils/billingDisplay.js';
import styles from './DisputeApprovalPage.module.css';

// Port of DISPUTE_COL_CONFIG (LMS!.html ~4943-4975) — each tab shows its own
// column subset, indexed into the fixed 21-column Dispute Approval row.
const COL_CONFIG = {
  all: {
    cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20],
    labels: ['Container', 'Client Code', 'Client Name', 'Size', 'Type', 'Location', 'Month', 'Year', 'Amount', 'Dispute Type', 'Remarks', 'Dispute Date', 'Status', 'Period', 'Client Email', 'Sitaram Conf', 'Sitaram Approval', 'CN Required', 'Pushpa Email']
  },
  operation: {
    cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18],
    labels: ['Container', 'Client Code', 'Client Name', 'Size', 'Type', 'Location', 'Month', 'Year', 'Amount', 'Dispute Type', 'Remarks', 'Dispute Date', 'Status', 'Period', 'Client Email', 'Sitaram Conf', 'Sitaram Approval']
  },
  invoice: {
    cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 19, 20],
    labels: ['Container', 'Client Code', 'Client Name', 'Size', 'Type', 'Location', 'Month', 'Year', 'Amount', 'Dispute Type', 'Remarks', 'Dispute Date', 'Status', 'Client Email', 'CN Required', 'Pushpa Email']
  },
  other: {
    cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    labels: ['Container', 'Client Code', 'Client Name', 'Size', 'Type', 'Location', 'Month', 'Year', 'Amount', 'Dispute Type', 'Remarks', 'Dispute Date', 'Status']
  }
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'operation', label: 'Operation' },
  { key: 'invoice', label: 'Invoice Bill' },
  { key: 'other', label: 'Other' }
];

const STATUS_COL = 12; // 0-based index of the "Status" column in every config

/**
 * Dispute Approval — port of LMS!.html's fetchDisputeApproval /
 * renderDisputeApproval / onDisputeAction (~4932-5086).
 *
 * This is an APPROVAL-ONLY queue, not a dispute-raising screen: disputes are
 * raised via onDisputeAll / onDisputeSingle / onDisputeCat, which only exist
 * on the Billing/Receivables pages (LMS!.html ~7241-7258, with their
 * "Dispute" buttons at ~7749/7991/8074) and call openDisputeModal() there.
 * Nothing in the disputeApproval section (~4900-5086) opens that modal or
 * raises a dispute — confirmed by reading the full section and by searching
 * the file for every openDisputeModal/onDispute* call site. This page's only
 * job is to list pending disputes and Approve/Reject them.
 */
export function DisputeApprovalPage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useAsync(() => disputesApi.getDisputeApprovalData(), []);
  const { canAct } = usePermission();
  // saveDisputeApprovalAction's actual checkActionPermission call in
  // disputes.service.js is ('receivables', ...) — gate on that.
  const canApprove = canAct('receivables');
  const { user } = useAuth();
  const showToast = useToast();

  const [busyRow, setBusyRow] = useState(null); // { rowNum, action }
  const [confirmReject, setConfirmReject] = useState(null); // row pending reject confirmation

  const config = COL_CONFIG[tab] || COL_CONFIG.all;
  const { cols, labels } = useMemo(() => {
    const c = [];
    const l = [];
    for (let i = 0; i < config.labels.length; i++) {
      // System-wide: rate/amount/pricing columns are hidden from every grid.
      if (isRateOrAmountHeader(config.labels[i])) continue;
      c.push(config.cols[i]);
      l.push(config.labels[i]);
    }
    return { cols: c, labels: l };
  }, [config]);

  const filtered = useMemo(() => {
    let list = filterRows(data?.data || [], search);
    if (tab !== 'all') {
      list = list.filter((d) => String(d.row[9] || '').trim().toLowerCase().indexOf(tab) !== -1);
    }
    return list;
  }, [data, search, tab]);

  const counts = data?.counts || {};
  const pending = data?.pending || 0;

  const runAction = async (rowMeta, action) => {
    setBusyRow({ rowNum: rowMeta._rowNum, action });
    try {
      const res = await disputesApi.saveDisputeApprovalAction(rowMeta._rowNum, action, user?.email || '');
      if (res.result === 'ALREADY_PROCESSED') showToast('Already processed by another user', 'info');
      else showToast(action === 'Approved' ? 'Dispute approved' : 'Dispute rejected');
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setBusyRow(null);
      setConfirmReject(null);
    }
  };

  const handleApprove = (rowMeta) => runAction(rowMeta, 'Approved');
  const handleRejectClick = (rowMeta) => setConfirmReject(rowMeta);
  const confirmRejectAction = () => { if (confirmReject) runAction(confirmReject, 'Rejected'); };

  return (
    <>
      <PageHeader
        title="Dispute Approval"
        subtitle="Review and action disputes raised from Billing and Receivables"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <Card>
        <div className={styles.tabRow}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          className={styles.search}
          placeholder="Search disputes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search disputes"
        />

        {!loading && !error && (
          <div className={styles.kpiRow}>
            <button type="button" className={`${styles.kpiCard} ${tab === 'all' ? styles.kpiActive : ''}`} onClick={() => setTab('all')}>
              <span className={styles.kpiLabel}>Total Pending</span>
              <span className={styles.kpiValue}>{pending}</span>
            </button>
            <button type="button" className={`${styles.kpiCard} ${tab === 'operation' ? styles.kpiActive : ''}`} onClick={() => setTab('operation')}>
              <span className={styles.kpiLabel}>Operation</span>
              <span className={styles.kpiValue}>{counts.operation || 0}</span>
            </button>
            <button type="button" className={`${styles.kpiCard} ${tab === 'invoice' ? styles.kpiActive : ''}`} onClick={() => setTab('invoice')}>
              <span className={styles.kpiLabel}>Invoice Bill</span>
              <span className={styles.kpiValue}>{counts.invoice || 0}</span>
            </button>
            <button type="button" className={`${styles.kpiCard} ${tab === 'other' ? styles.kpiActive : ''}`} onClick={() => setTab('other')}>
              <span className={styles.kpiLabel}>Other</span>
              <span className={styles.kpiValue}>{counts.other || 0}</span>
            </button>
          </div>
        )}

        {loading && <LoadingSpinner label="Loading disputes..." />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && filtered.length === 0 && <EmptyState message="No disputes found" />}

        {!loading && !error && filtered.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {labels.map((l) => <th key={l}>{l}</th>)}
                  <th className={styles.actionsCol}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const isPend = d.row[STATUS_COL] === 'Pending';
                  const busy = busyRow?.rowNum === d._rowNum;
                  return (
                    <tr key={d._rowNum}>
                      {cols.map((ci) => (
                        <td key={ci} className={ci === STATUS_COL ? styles.statusCell : undefined}>
                          {ci === STATUS_COL ? <StatusBadge status={d.row[ci]} /> : renderCellValue(d.row[ci])}
                        </td>
                      ))}
                      <td className={styles.actionsCol}>
                        {isPend ? (
                          canApprove ? (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                loading={busy && busyRow.action === 'Approved'}
                                disabled={busy}
                                onClick={() => handleApprove(d)}
                              >
                                Approve
                              </Button>{' '}
                              <Button
                                variant="danger"
                                size="sm"
                                loading={busy && busyRow.action === 'Rejected'}
                                disabled={busy}
                                onClick={() => handleRejectClick(d)}
                              >
                                Reject
                              </Button>
                            </>
                          ) : <span className={styles.viewOnly}>View only</span>
                        ) : <span className={styles.resolved}>Resolved</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmReject}
        title="Reject dispute"
        message="Reject this dispute? This action cannot be undone."
        confirmLabel="Reject"
        danger
        loading={busyRow?.action === 'Rejected'}
        onConfirm={confirmRejectAction}
        onClose={() => setConfirmReject(null)}
      />
    </>
  );
}
