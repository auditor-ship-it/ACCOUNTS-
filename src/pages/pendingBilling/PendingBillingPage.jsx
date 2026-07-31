import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { Button } from '../../components/common/Button.jsx';
import { DataTable } from '../../components/common/DataTable.jsx';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.jsx';
import { renderCellValue } from '../../components/common/CellValue.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermission } from '../../hooks/usePermission.js';
import { apiErrorMessage } from '../../api/client.js';
import * as pendingBillingApi from '../../api/pendingBilling.api.js';
import { visibleHeaderIndexes, filterRows } from '../../utils/billingDisplay.js';
import styles from './PendingBillingPage.module.css';

/**
 * Port of the Pending Billing tab (LMS!.html ~7272-7317, fetchPendingBilling/
 * renderPendingBilling). Rows land here via the "Transfer" action on the
 * Billing Sales page (billing/BillingPage.jsx); the only action available
 * here is the reverse — "Send back to Billing Sales" (onSendBackToBilling).
 */
export function PendingBillingPage() {
  const showToast = useToast();
  const { canAct } = usePermission();
  const canBill = canAct('billing');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null); // row pending confirm
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await pendingBillingApi.getPendingBillingData();
      setData(res);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const headers = data?.headers || [];
  const visibleIdx = visibleHeaderIndexes(headers);
  const filtered = filterRows(data?.data || [], search);

  const handleConfirmSendBack = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await pendingBillingApi.sendBackToBilling(target._rowNum);
      if (res.result === 'NOT_IN_PENDING') showToast('Not in pending status', 'info');
      else showToast('Sent back to Billing Sales', 'success');
      load();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <>
      <PageHeader title="Pending Billing" subtitle="Containers transferred from Billing Sales, awaiting invoice upload" />

      <Card>
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.search}
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search pending billing records"
          />
        </div>

        {!loading && !error && (
          <div className={styles.countLine}>📋 {filtered.length} record(s) transferred to pending</div>
        )}

        <DataTable
          headers={[...visibleIdx.map((i) => headers[i]), 'Transfer Date']}
          rows={filtered}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage={search ? 'No records match your search' : 'No pending records — transfer rows from Billing Sales'}
          rowKey={(r) => r._rowNum}
          renderRow={(values, rowMeta) => (
            <>
              {visibleIdx.map((ci, di) => (
                <td key={ci} className={di === 0 ? styles.firstCell : undefined}>{renderCellValue(values[ci])}</td>
              ))}
              <td className={styles.transferDate}>{rowMeta.transferDate}</td>
            </>
          )}
          renderActions={canBill ? (row) => (
            <Button variant="secondary" size="sm" onClick={() => setTarget(row)}>&#8592; Send Back</Button>
          ) : undefined}
        />
      </Card>

      <ConfirmDialog
        open={!!target}
        title="Send back to Billing Sales"
        message="Send this back to Billing Sales?"
        confirmLabel="Send Back"
        loading={busy}
        onConfirm={handleConfirmSendBack}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
