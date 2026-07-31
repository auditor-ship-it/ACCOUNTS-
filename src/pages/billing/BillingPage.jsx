import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { Button } from '../../components/common/Button.jsx';
import { DataTable } from '../../components/common/DataTable.jsx';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { renderCellValue } from '../../components/common/CellValue.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermission } from '../../hooks/usePermission.js';
import { apiErrorMessage } from '../../api/client.js';
import * as billingApi from '../../api/billing.api.js';
import * as pendingBillingApi from '../../api/pendingBilling.api.js';
import { visibleHeaderIndexes, filterRows } from '../../utils/billingDisplay.js';
import {
  computeBillCols, billCountByMonth, billMonthKey,
  distinctFYs, defaultFy, monthsOfFy, defaultMonth
} from '../../utils/billingMonth.js';
import { BillingUploadModal } from './BillingUploadModal.jsx';
import { BillingMonthTabs } from './BillingMonthTabs.jsx';
import styles from './BillingPage.module.css';

/* Port of the Billing Sales category tabs (LMS!.html ~4376-4381,
 * showBillingSub). 'Lease' -> billing.routes.js; 'Transportion' ->
 * transport.routes.js; every other tab -> category.routes.js's "Other Order
 * Type" workflow (Sale / Accessories / AMC / Other), confirmed by reading
 * fetchBillingTab (LMS!.html 7339-7347) and billingCategory.service.js's
 * BILLING_TYPE_MATCH map. */
const CATEGORIES = ['Lease', 'Sale', 'Accessories', 'Transportion', 'AMC', 'Other'];

const FETCH_INVOICE_CONFIRM =
  'Invoice No. and Attachment will be fetched by Container No. and written into Billing Sales. Existing values will be overwritten. Continue?';

async function loadCategoryData(category) {
  if (category === 'Lease') return billingApi.getBillingData();
  if (category === 'Transportion') return billingApi.getBillingTransportData();
  return billingApi.getBillingCategoryData(category);
}

async function saveSingleAction(category, rowNum, payload) {
  if (category === 'Lease') return billingApi.saveBillingAction({ rowNum, ...payload });
  if (category === 'Transportion') return billingApi.saveBillingTransportAction(rowNum, payload);
  return billingApi.saveBillingCategoryAction(rowNum, { ...payload, category });
}

export function BillingPage() {
  const { user } = useAuth();
  const showToast = useToast();
  const { canAct } = usePermission();
  const canBill = canAct('billing');

  const [category, setCategory] = useState('Lease');
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [uploadModal, setUploadModal] = useState(null); // {mode:'single'|'bulk', rowNum?, containerLabel?, rows?}
  const [uploadBusy, setUploadBusy] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null); // row pending confirm
  const [transferBusy, setTransferBusy] = useState(false);
  const [fetchConfirmOpen, setFetchConfirmOpen] = useState(false);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [fy, setFy] = useState(null);
  const [month, setMonth] = useState(null);
  const reqIdRef = useRef(0);

  const fetchCategory = useCallback(async (cat) => {
    setLoading(true);
    setError('');
    const id = ++reqIdRef.current;
    try {
      const res = await loadCategoryData(cat);
      if (id !== reqIdRef.current) return;
      setCache((c) => ({ ...c, [cat]: res }));
    } catch (e) {
      if (id !== reqIdRef.current) return;
      setError(apiErrorMessage(e));
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategory(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const switchCategory = (cat) => {
    if (cat === category) return;
    setCategory(cat);
    setSelected(new Set());
    setSearch('');
    // Port of showBillingSub() resetting currentBillingFY/currentBillingMonth
    // to null on category change, so each category re-defaults its own FY/month.
    setFy(null);
    setMonth(null);
  };

  const reload = () => fetchCategory(category);

  const entry = cache[category];
  const headers = entry?.headers || [];
  const visibleIdx = visibleHeaderIndexes(headers);
  const allData = entry?.data || [];

  // Port of the Billing Sales FY dropdown + Apr–Mar month tab strip
  // (LMS!.html buildBillingFyAndTabs) — a pure client-side filter over the
  // already-fetched category data, only shown when at least one row has a
  // detectable billing month.
  const billCols = useMemo(() => computeBillCols(headers), [headers]);
  const have = useMemo(() => billCountByMonth(allData, billCols), [allData, billCols]);
  const billMonthFilterActive = Object.keys(have).length > 0;
  const fys = useMemo(() => (billMonthFilterActive ? distinctFYs(have) : []), [billMonthFilterActive, have]);

  useEffect(() => {
    if (!billMonthFilterActive) return;
    if (!fy || !fys.includes(fy)) setFy(defaultFy(fys, have));
  }, [billMonthFilterActive, fys, have, fy]);

  const months = useMemo(() => (fy ? monthsOfFy(fy) : []), [fy]);

  useEffect(() => {
    if (!billMonthFilterActive || !fy) return;
    if (!month || !months.includes(month)) setMonth(defaultMonth(months, have));
  }, [billMonthFilterActive, fy, months, have, month]);

  const monthScoped = billMonthFilterActive && month
    ? allData.filter((item) => billMonthKey(item.row || item, billCols) === month)
    : allData;

  const filtered = filterRows(monthScoped, search);

  const toggleSelect = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllVisible = () => setSelected(new Set(filtered.map((r) => r._rowNum)));
  const clearSelection = () => setSelected(new Set());

  const openSingleUpload = (row) => {
    const cells = row.row || row;
    const label = category === 'Lease' ? cells[0] : `Row ${row._rowNum}`;
    setUploadModal({ mode: 'single', rowNum: row._rowNum, containerLabel: label });
  };

  const openBulkUpload = () => {
    if (selected.size === 0) {
      showToast('Select containers first', 'error');
      return;
    }
    setUploadModal({ mode: 'bulk', rows: allData.filter((r) => selected.has(r._rowNum)) });
  };

  const handleUploadSubmit = async ({ invoiceNo, ext, base64Data, mimeType, fileName }) => {
    setUploadBusy(true);
    try {
      const cn = uploadModal.mode === 'single' ? (category === 'Lease' ? (uploadModal.containerLabel || '') : '') : '';
      const generatedName = uploadModal.mode === 'bulk'
        ? `bulk_${invoiceNo}_${Date.now()}.${ext}`
        : `${cn || `row${uploadModal.rowNum}`}_billing_${Date.now()}.${ext}`;

      const { url } = await billingApi.uploadInvoiceFile({ base64Data, mimeType, fileName: generatedName || fileName });
      if (!url) throw new Error('Upload failed');

      const timestamp = new Date().toISOString();

      if (uploadModal.mode === 'bulk') {
        const identifiers = uploadModal.rows.map((r) => r._rowNum);
        const res = await billingApi.saveBulkBillingAction({
          identifiers, timestamp, attachmentUrl: url, userEmail: user?.email, invoiceNo, category
        });
        showToast(res.message, 'success');
        setSelected(new Set());
      } else {
        const res = await saveSingleAction(category, uploadModal.rowNum, {
          timestamp, attachmentUrl: url, userEmail: user?.email, invoiceNo
        });
        if (res.result === 'ALREADY_PROCESSED') showToast('Already processed', 'info');
        else showToast(`Invoice ${invoiceNo} uploaded`, 'success');
      }
      setUploadModal(null);
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!transferTarget) return;
    setTransferBusy(true);
    try {
      const res = await pendingBillingApi.transferToPendingBilling(transferTarget._rowNum, user?.email);
      if (res.result === 'ALREADY_TRANSFERRED') showToast('Already in Pending', 'info');
      else showToast('Transferred to Pending Billing', 'success');
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setTransferBusy(false);
      setTransferTarget(null);
    }
  };

  const handleConfirmFetchInvoice = async () => {
    setFetchBusy(true);
    try {
      const res = await billingApi.fetchBillingInvoiceFromTemplate();
      showToast(res.result, 'success');
      reload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setFetchBusy(false);
      setFetchConfirmOpen(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Billing Sales"
        subtitle="Upload invoices &amp; attachments per container, or transfer to Pending Billing"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className={styles.tabs}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.tab} ${cat === category ? styles.tabActive : ''}`}
            onClick={() => switchCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {billMonthFilterActive && fy && month && (
        <BillingMonthTabs
          fy={fy}
          fys={fys}
          onFyChange={(newFy) => { setFy(newFy); setMonth(null); }}
          months={months}
          currentMonth={month}
          onMonthChange={setMonth}
          have={have}
        />
      )}

      <Card>
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.search}
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search billing records"
          />
          {canBill && (
            <Button variant="accent" size="sm" onClick={() => setFetchConfirmOpen(true)} loading={fetchBusy} className={styles.fetchBtn}>
              ⟲ Fetch Invoice / Attachment
            </Button>
          )}
        </div>

        {canBill && (
          <div className={styles.bulkBar}>
            <span className={styles.bulkCount}>
              {selected.size > 0 ? <><Icon name="check" size="sm" /> {selected.size} selected</> : 'Check boxes to select rows for bulk upload'}
            </span>
            <Button variant="secondary" size="sm" onClick={selectAllVisible} disabled={filtered.length === 0}>
              Select all visible ({filtered.length})
            </Button>
            {selected.size > 0 && (
              <>
                <Button variant="secondary" size="sm" onClick={clearSelection}>Clear</Button>
                <Button variant="primary" size="sm" onClick={openBulkUpload}>
                  <Icon name="upload" size="sm" /> Bulk Upload ({selected.size} selected)
                </Button>
              </>
            )}
          </div>
        )}

        <DataTable
          headers={visibleIdx.map((i) => headers[i])}
          rows={filtered}
          loading={loading}
          error={entry?.missing ? `Sheet not found${entry.sheetName ? ` — create a sheet named "${entry.sheetName}"` : ''}` : error}
          onRetry={reload}
          emptyMessage={
            search
              ? 'No records match your search'
              : billMonthFilterActive && month
                ? `No pending invoices for ${month}`
                : 'No pending invoices'
          }
          selectable={canBill}
          selectedKeys={selected}
          onToggleSelect={(key) => toggleSelect(key)}
          rowKey={(r) => r._rowNum}
          renderRow={(values, rowMeta) => (
            visibleIdx.map((ci, di) => (
              <td key={ci} className={di === 0 ? styles.firstCell : undefined}>
                {di === 0 && rowMeta._isNew && <span className={styles.newBadge} title="New — not yet moved">NEW</span>}
                {renderCellValue(values[ci])}
              </td>
            ))
          )}
          renderActions={canBill ? (row) => (
            <div className={styles.actionCell}>
              <Button variant="primary" size="sm" onClick={() => openSingleUpload(row)}>Upload</Button>
              <Button variant="secondary" size="sm" onClick={() => setTransferTarget(row)}>Transfer</Button>
            </div>
          ) : undefined}
        />
      </Card>

      <BillingUploadModal
        open={!!uploadModal}
        mode={uploadModal?.mode}
        containerLabel={uploadModal?.containerLabel}
        count={uploadModal?.rows?.length}
        busy={uploadBusy}
        onClose={() => setUploadModal(null)}
        onSubmit={handleUploadSubmit}
      />

      <ConfirmDialog
        open={!!transferTarget}
        title="Transfer to Pending Billing"
        message={transferTarget ? `Transfer "${(transferTarget.row || transferTarget)[0] || `row ${transferTarget._rowNum}`}" to Pending Billing?` : ''}
        confirmLabel="Transfer"
        loading={transferBusy}
        onConfirm={handleConfirmTransfer}
        onClose={() => setTransferTarget(null)}
      />

      <ConfirmDialog
        open={fetchConfirmOpen}
        title="Fetch Invoice / Attachment"
        message={FETCH_INVOICE_CONFIRM}
        confirmLabel="Continue"
        loading={fetchBusy}
        onConfirm={handleConfirmFetchInvoice}
        onClose={() => setFetchConfirmOpen(false)}
      />
    </>
  );
}
