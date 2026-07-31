import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePermission } from '../../hooks/usePermission.js';
import { useToast } from '../../context/ToastContext.jsx';
import { apiErrorMessage } from '../../api/client.js';
import { uploadFileToDrive } from '../../api/upload.api.js';
import {
  RECEIVABLES_CATEGORIES,
  getReceivablesLeaseData,
  getReceivablesForCategory,
  saveReceivableClientFollowUp,
  saveFollowUpForCategory,
  saveReceivableLeasePayment,
  savePaymentForCategory,
  saveBulkReceivablePayment
} from '../../api/receivables.api.js';
import { PageHeader, Card, Button, DataTable, Modal, renderCellValue } from '../../components/common/index.js';
import { Icon } from '../../components/ui/Icon.jsx';
import dtStyles from '../../components/common/DataTable.module.css';
import { visibleHeaderIndexes, filterRows } from '../../utils/billingDisplay.js';
import { formatAmt } from '../../utils/format.js';
import { FollowUpModal } from './FollowUpModal.jsx';
import { PaymentModal } from './PaymentModal.jsx';
import { PaymentLogModal } from './PaymentLogModal.jsx';
import styles from './ReceivablesPage.module.css';

/**
 * Receivables — port of showRecvType()/fetchReceivables()/fetchReceivablesCategory()/
 * renderReceivables()/renderReceivablesCategory() (LMS!.html ~4424-4484, 7639-8330).
 *
 * Six category tabs (RECEIVABLES_CATEGORIES, confirmed from #recvTypeTabs):
 * 'Lease' has its own bespoke client-wise/invoice-wise grouped UI (own sheet,
 * own bulk-payment flow); 'Transportion' and the remaining Sale/Accessories/
 * AMC/Other all share the flat "category" list/detail UI, differing only in
 * which backend RPC they hit (see getReceivablesForCategory/
 * saveFollowUpForCategory/savePaymentForCategory dispatch in receivables.api.js).
 *
 * SCOPE NOTE: the original's per-row "Dispute" buttons and dispute-history
 * panel are intentionally not reproduced here — disputes are filed from this
 * same screen in the original but reviewed/managed on a wholly separate
 * "Dispute Approval" page/workflow (backend/src/services/disputes.service.js,
 * routes/disputes.routes.js — a dedicated DisputeApprovalPage.jsx already
 * exists in this app). Follow-up, payment, payment log, and bulk payment —
 * this task's actual scope — are fully implemented below.
 */

const AGEING_BANDS = ['0-30', '31-60', '61-90', '90+'];
const BAND_LABEL = { '90+': 'overdue', '61-90': 'critical', '31-60': 'warning', '0-30': 'safe' };

function bandBadgeClass(band) {
  return styles[BAND_LABEL[band]] || styles.bandNa;
}

function bandTextClass(band) {
  return styles[`text_${BAND_LABEL[band]}`] || styles.text_na;
}

function splitLines(s) {
  return String(s || '').split('\n').filter((x) => x.trim() !== '');
}

/* Port of filterArr() — case-insensitive substring match over the first 8 cells. */
function rowMatchesSearch(cells, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  const lim = Math.min(cells.length, 8);
  for (let i = 0; i < lim; i++) {
    if (String(cells[i] ?? '').toLowerCase().indexOf(t) !== -1) return true;
  }
  return false;
}

export function ReceivablesPage() {
  const { user } = useAuth();
  const { canAct } = usePermission();
  const showToast = useToast();
  const canRecv = canAct('receivables');

  const [recvType, setRecvType] = useState('Lease');
  const [filterType, setFilterType] = useState('pending'); // 'pending' | 'payment'
  const [viewMode, setViewMode] = useState('client'); // Lease only: 'client' | 'invoice'
  const [search, setSearch] = useState('');
  const [clientCodeFilter, setClientCodeFilter] = useState('');
  const [clientNameFilter, setClientNameFilter] = useState('');
  const [ageingFilter, setAgeingFilter] = useState('');

  const [cache, setCache] = useState({});
  const [loadingKey, setLoadingKey] = useState({});
  const [errorKey, setErrorKey] = useState({});

  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [detailGroupKey, setDetailGroupKey] = useState(null);
  const [detailCatRowNum, setDetailCatRowNum] = useState(null);

  const [followUpTarget, setFollowUpTarget] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [logView, setLogView] = useState(null);

  const cacheKey = `${recvType}|${filterType}`;
  const isPending = filterType === 'pending';

  const load = useCallback(async (type, filter) => {
    const key = `${type}|${filter}`;
    setLoadingKey((s) => ({ ...s, [key]: true }));
    setErrorKey((s) => ({ ...s, [key]: '' }));
    try {
      const res = type === 'Lease' ? await getReceivablesLeaseData(filter) : await getReceivablesForCategory(type, filter);
      setCache((s) => ({ ...s, [key]: res }));
    } catch (e) {
      setErrorKey((s) => ({ ...s, [key]: apiErrorMessage(e) }));
    } finally {
      setLoadingKey((s) => ({ ...s, [key]: false }));
    }
  }, []);

  useEffect(() => {
    if (!cache[cacheKey] && !loadingKey[cacheKey]) load(recvType, filterType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const invalidateAndReload = () => {
    setCache((s) => { const n = { ...s }; delete n[cacheKey]; return n; });
    load(recvType, filterType);
  };

  function switchType(type) {
    if (type === recvType) return;
    setRecvType(type);
    setFilterType('pending');
    setViewMode('client');
    setSearch('');
    setClientCodeFilter('');
    setClientNameFilter('');
    setAgeingFilter('');
    setSelectedContainers(new Set());
    setExpandedGroups(new Set());
    setDetailGroupKey(null);
    setDetailCatRowNum(null);
  }

  function switchFilter(f) {
    if (f === filterType) return;
    setFilterType(f);
    setSelectedContainers(new Set());
    setDetailGroupKey(null);
    setDetailCatRowNum(null);
  }

  const data = cache[cacheKey];
  const loading = !!loadingKey[cacheKey];
  const error = errorKey[cacheKey];

  /* ============================= FOLLOW-UP ============================= */
  async function submitFollowUp(remarks) {
    if (!followUpTarget) return;
    setFollowUpBusy(true);
    try {
      const timestamp = new Date().toISOString();
      if (followUpTarget.mode === 'lease-client') {
        const res = await saveReceivableClientFollowUp({ clientCode: followUpTarget.clientCode, timestamp, remarks, userEmail: user?.email });
        const m = /^OK:(\d+)/.exec(res?.message || '');
        showToast(m ? `Follow-up recorded for ${m[1]} container(s)` : 'Follow-up recorded');
      } else {
        await saveFollowUpForCategory(followUpTarget.category, followUpTarget.rowNum, { timestamp, remarks, userEmail: user?.email });
        showToast('Follow-up recorded');
      }
      setFollowUpTarget(null);
      invalidateAndReload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setFollowUpBusy(false);
    }
  }

  /* ============================== PAYMENT =============================== */
  async function submitPayment(payload) {
    if (!paymentTarget) return;
    setPaymentBusy(true);
    const timestamp = new Date().toISOString();
    try {
      if (paymentTarget.mode === 'lease-bulk') {
        const containerNos = [...selectedContainers];
        const res = await saveBulkReceivablePayment({
          containerNos,
          timestamp,
          amount: payload.amount,
          utr: payload.utr,
          remarks: payload.remarks,
          userEmail: user?.email,
          base64Data: payload.file?.base64Data || '',
          mimeType: payload.file?.mimeType || '',
          fileName: payload.file?.fileName || ''
        });
        showToast(res.message);
        setSelectedContainers(new Set());
      } else {
        let attachmentUrl = '';
        if (payload.file) attachmentUrl = await uploadFileToDrive(payload.file);

        if (paymentTarget.mode === 'lease-single') {
          const res = await saveReceivableLeasePayment({
            containerNo: paymentTarget.containerNo, timestamp, amount: payload.amount, utr: payload.utr,
            remarks: payload.remarks, userEmail: user?.email, attachmentUrl
          });
          showToast(res.status === 'FULL' ? 'Payment recorded — Fully Paid' : 'Partial payment recorded');
        } else {
          const res = await savePaymentForCategory(paymentTarget.category, paymentTarget.rowNum, {
            timestamp, amount: payload.amount, utr: payload.utr, remarks: payload.remarks, userEmail: user?.email, attachmentUrl
          });
          const result = res.result ?? res.status;
          showToast(result === 'FULL' ? 'Payment recorded — Fully Paid' : 'Partial payment recorded');
        }
      }
      setPaymentTarget(null);
      invalidateAndReload();
    } catch (e) {
      showToast(apiErrorMessage(e), 'error');
    } finally {
      setPaymentBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Receivables" subtitle="Follow-up and record payments, by category" />

      <div className={styles.tabs}>
        {RECEIVABLES_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.tab} ${recvType === cat ? styles.tabActive : ''}`}
            onClick={() => switchType(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <Card>
        {!canRecv && (
          <div className={styles.viewOnlyBanner}>🔒 <strong>View Only</strong> — Action buttons are disabled for your role.</div>
        )}

        <div className={styles.subTabs}>
          <button type="button" className={`${styles.subTab} ${isPending ? styles.subTabActive : ''}`} onClick={() => switchFilter('pending')}>Pending</button>
          <button type="button" className={`${styles.subTab} ${!isPending ? styles.subTabActive : ''}`} onClick={() => switchFilter('payment')}>Payment Received</button>
        </div>

        {recvType === 'Lease' ? (
          <LeaseSection
            data={data}
            loading={loading}
            error={error}
            onRetry={invalidateAndReload}
            isPending={isPending}
            viewMode={viewMode}
            setViewMode={setViewMode}
            search={search}
            setSearch={setSearch}
            clientCodeFilter={clientCodeFilter}
            setClientCodeFilter={setClientCodeFilter}
            clientNameFilter={clientNameFilter}
            setClientNameFilter={setClientNameFilter}
            ageingFilter={ageingFilter}
            setAgeingFilter={setAgeingFilter}
            expandedGroups={expandedGroups}
            setExpandedGroups={setExpandedGroups}
            selectedContainers={selectedContainers}
            setSelectedContainers={setSelectedContainers}
            detailGroupKey={detailGroupKey}
            setDetailGroupKey={setDetailGroupKey}
            canRecv={canRecv}
            onOpenFollowUp={(clientCode, clientName) => setFollowUpTarget({ mode: 'lease-client', clientCode, clientName })}
            onOpenPaymentSingle={(containerNo) => setPaymentTarget({ mode: 'lease-single', containerNo })}
            onOpenPaymentBulk={() => setPaymentTarget({ mode: 'lease-bulk' })}
            onViewFollowUpLog={(rows) => setLogView({ type: 'followup', rows })}
            onViewPaymentLog={(item) => setLogView({ type: 'payment', item })}
          />
        ) : (
          <CategorySection
            category={recvType}
            data={data}
            loading={loading}
            error={error}
            onRetry={invalidateAndReload}
            isPending={isPending}
            search={search}
            setSearch={setSearch}
            clientCodeFilter={clientCodeFilter}
            setClientCodeFilter={setClientCodeFilter}
            clientNameFilter={clientNameFilter}
            setClientNameFilter={setClientNameFilter}
            detailRowNum={detailCatRowNum}
            setDetailRowNum={setDetailCatRowNum}
            canRecv={canRecv}
            onOpenFollowUp={(rowNum) => setFollowUpTarget({ mode: 'category', category: recvType, rowNum })}
            onOpenPayment={(rowNum) => setPaymentTarget({ mode: 'category', category: recvType, rowNum })}
            onViewFollowUpLog={(item) => setLogView({ type: 'followup', rows: [{ dates: item.logV, remarks: item.logW, users: item.logX }] })}
            onViewPaymentLog={(item) => setLogView({ type: 'payment', item })}
          />
        )}
      </Card>

      <FollowUpModal
        open={!!followUpTarget}
        title={followUpTarget?.mode === 'lease-client' ? 'Follow Up — All Containers' : 'Add Follow-up'}
        subtitle={followUpTarget?.mode === 'lease-client' ? `Client: ${followUpTarget?.clientName || followUpTarget?.clientCode}` : undefined}
        submitting={followUpBusy}
        onClose={() => setFollowUpTarget(null)}
        onSubmit={submitFollowUp}
      />

      <PaymentModal
        open={!!paymentTarget}
        title={paymentTarget?.mode === 'lease-bulk' ? `Bulk Payment (${selectedContainers.size} selected)` : 'Record Payment'}
        subtitle={paymentTarget?.mode === 'lease-single' ? `Container: ${paymentTarget?.containerNo}` : undefined}
        submitting={paymentBusy}
        onClose={() => setPaymentTarget(null)}
        onSubmit={submitPayment}
      />

      {logView?.type === 'followup' && (
        <CombinedFollowUpLogModal rows={logView.rows} onClose={() => setLogView(null)} />
      )}

      {logView?.type === 'payment' && (
        <PaymentLogModal
          open
          onClose={() => setLogView(null)}
          payLogAD={logView.item.payLogAD}
          payLogV={logView.item.payLogV}
          payLogW={logView.item.payLogW}
          payLogX={logView.item.payLogX}
        />
      )}
    </>
  );
}

/* =====================================================================
   Combined follow-up log — port of viewRecvClientLog() (Lease, combines
   every container's log under one client) and the plain per-row log
   (renderLogModal, used as-is for Category rows via the shared LogModal).
===================================================================== */
function CombinedFollowUpLogModal({ rows, onClose }) {
  const entries = [];
  for (const r of rows) {
    const dates = splitLines(r.dates);
    const remarks = splitLines(r.remarks);
    const users = splitLines(r.users);
    for (let j = 0; j < dates.length; j++) {
      entries.push({ container: r.container, date: dates[j] || '-', remark: remarks[j] || '-', user: users[j] || '-' });
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  // Only show the Container column when the log actually spans more than one
  // container (client-level "Follow All" / group "Log"); a single-container
  // log matches the original's plain 3-column renderLogModal (Date/Remarks/User).
  const showContainerCol = new Set(rows.map((r) => r.container).filter(Boolean)).size > 1;

  return (
    <Modal open onClose={onClose} title="Follow-up History" width="560px">
      {!entries.length ? (
        <p style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center', padding: '20px 0' }}>No follow-ups recorded.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                {showContainerCol && <th style={{ padding: '6px 8px' }}>Container</th>}
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Remarks</th>
                <th style={{ padding: '6px 8px' }}>User</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                  {showContainerCol && <td style={{ padding: '8px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{e.container}</td>}
                  <td style={{ padding: '8px', color: 'var(--text-3)' }}>{e.date}</td>
                  <td style={{ padding: '8px' }}>{e.remark}</td>
                  <td style={{ padding: '8px', color: 'var(--accent)' }}>{e.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* =====================================================================
   LEASE — client-wise / invoice-wise grouped view
===================================================================== */
function LeaseSection(props) {
  const {
    data, loading, error, onRetry, isPending, viewMode, setViewMode,
    search, setSearch, clientCodeFilter, setClientCodeFilter, clientNameFilter, setClientNameFilter,
    ageingFilter, setAgeingFilter, expandedGroups, setExpandedGroups,
    selectedContainers, setSelectedContainers, detailGroupKey, setDetailGroupKey,
    canRecv, onOpenFollowUp, onOpenPaymentSingle, onOpenPaymentBulk, onViewFollowUpLog, onViewPaymentLog
  } = props;

  const isInv = viewMode === 'invoice';
  const rawGroups = isInv ? (data?.invoices || []) : (data?.clients || []);

  const groups = useMemo(() => {
    return rawGroups
      .map((g) => {
        let containers = g.containers;
        if (search.trim()) containers = containers.filter((c) => rowMatchesSearch(c.row, search));
        if (isPending && ageingFilter) containers = containers.filter((c) => c.band === ageingFilter);
        return { ...g, containers, containerCount: containers.length };
      })
      .filter((g) => {
        if (clientCodeFilter && g.clientCode !== clientCodeFilter) return false;
        if (clientNameFilter && g.clientName !== clientNameFilter) return false;
        return g.containerCount > 0;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawGroups, search, isPending, ageingFilter, clientCodeFilter, clientNameFilter]);

  const clientOptions = useMemo(() => {
    const codes = new Map();
    const names = new Map();
    for (const c of data?.clients || []) {
      if (c.clientCode) codes.set(c.clientCode, true);
      if (c.clientName) names.set(c.clientName, true);
    }
    return { codes: [...codes.keys()], names: [...names.keys()] };
  }, [data]);

  const allVisibleContainerNos = useMemo(() => {
    const s = new Set();
    for (const g of groups) for (const c of g.containers) s.add(c.row[0]);
    return s;
  }, [groups]);

  const allSelected = allVisibleContainerNos.size > 0 && [...allVisibleContainerNos].every((cn) => selectedContainers.has(cn));

  function toggleSelectAll() {
    setSelectedContainers(allSelected ? new Set() : new Set(allVisibleContainerNos));
  }

  function toggleContainer(cn) {
    setSelectedContainers((prev) => {
      const n = new Set(prev);
      if (n.has(cn)) n.delete(cn); else n.add(cn);
      return n;
    });
  }

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  const groupKeyOf = (g) => (isInv ? (g.invoiceNo || '_no_inv_') : g.clientCode);
  const detailGroup = detailGroupKey != null ? groups.find((g) => groupKeyOf(g) === detailGroupKey) : null;

  if (loading) return <DataTable headers={[]} rows={[]} loading />;
  if (error) return <DataTable headers={[]} rows={[]} error={error} onRetry={onRetry} />;
  if (!data?.clients?.length) return <DataTable headers={[]} rows={[]} emptyMessage="No records found" />;

  return (
    <div>
      <div className={styles.summaryBar}>
        <span className={styles.summaryLabel}>{isPending ? 'Total Outstanding' : 'Total Received'}</span>
        <span className={isPending ? styles.summaryValueRed : styles.summaryValueGreen}>
          {formatAmt(isPending ? (data?.total || 0) : (data?.totalReceived || 0))}
        </span>
      </div>

      <div className={styles.ctrlBar}>
        <input type="text" className={styles.search} placeholder="Search Container, Client..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search receivables" />
        <input
          type="text" list="recvClientCodeList" className={styles.filterInput} placeholder="Search Client Code..."
          value={clientCodeFilter} onChange={(e) => setClientCodeFilter(e.target.value)} aria-label="Filter by client code"
        />
        <datalist id="recvClientCodeList">{clientOptions.codes.map((c) => <option key={c} value={c} />)}</datalist>
        <input
          type="text" list="recvClientNameList" className={styles.filterInput} placeholder="Search Client Name..."
          value={clientNameFilter} onChange={(e) => setClientNameFilter(e.target.value)} aria-label="Filter by client name"
        />
        <datalist id="recvClientNameList">{clientOptions.names.map((c) => <option key={c} value={c} />)}</datalist>
        {isPending && (
          <select className={styles.filterInput} value={ageingFilter} onChange={(e) => setAgeingFilter(e.target.value)} aria-label="Filter by ageing">
            <option value="">All Ageing</option>
            {AGEING_BANDS.map((b) => <option key={b} value={b}>{b} Days</option>)}
          </select>
        )}
      </div>

      <div className={styles.viewToggle}>
        <button type="button" className={viewMode === 'client' ? styles.viewToggleActive : ''} onClick={() => { setViewMode('client'); setDetailGroupKey(null); }}>Client Wise</button>
        <button type="button" className={viewMode === 'invoice' ? styles.viewToggleActive : ''} onClick={() => { setViewMode('invoice'); setDetailGroupKey(null); }}>Invoice Wise</button>
      </div>

      {detailGroup ? (
        <LeaseGroupDetail
          group={detailGroup}
          isInv={isInv}
          isPending={isPending}
          canRecv={canRecv}
          onBack={() => setDetailGroupKey(null)}
          onOpenFollowUp={() => onOpenFollowUp(detailGroup.clientCode, detailGroup.clientName)}
          onOpenPaymentSingle={onOpenPaymentSingle}
          onViewFollowUpLog={onViewFollowUpLog}
          onViewPaymentLog={onViewPaymentLog}
        />
      ) : (
        <>
          {canRecv && isPending && (
            <div className={styles.bulkBar}>
              <label className={styles.selectAllLabel}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={!allVisibleContainerNos.size} />
                Select All Visible
              </label>
              {selectedContainers.size > 0 && (
                <Button variant="accent" size="sm" onClick={onOpenPaymentBulk}>
                  <Icon name="check" size="sm" /> Bulk Payment ({selectedContainers.size} selected)
                </Button>
              )}
            </div>
          )}

          {!groups.length ? (
            <DataTable headers={[]} rows={[]} emptyMessage="No records found" />
          ) : (
            <div className={dtStyles.scrollWrap}>
              <table className={dtStyles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>{isInv ? 'Invoice No.' : 'Client Name'}</th>
                    <th>Client Code</th>
                    <th style={{ textAlign: 'center' }}>Containers</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const key = groupKeyOf(g);
                    const expanded = expandedGroups.has(key);
                    const anyLog = g.containers.some((c) => c.logV && c.logV.trim() !== '');
                    return (
                      <Fragment key={key}>
                        <tr className={styles.groupRow} onClick={() => toggleGroup(key)}>
                          <td style={{ textAlign: 'center' }}>{expanded ? '▼' : '▶'}</td>
                          <td className={styles.groupTitle}>{isInv ? (g.invoiceNo || 'No Invoice') : g.clientName}</td>
                          <td><span className={styles.codeChip}>{g.clientCode}</span></td>
                          <td style={{ textAlign: 'center', fontWeight: 700 }}>{g.containerCount}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            {anyLog && <Button variant="secondary" size="sm" onClick={() => onViewFollowUpLog(g.containers.map((c) => ({ container: c.row[0], dates: c.logV, remarks: c.logW, users: c.logX })))}>Log</Button>}
                            {canRecv && isPending && <Button variant="primary" size="sm" onClick={() => onOpenFollowUp(g.clientCode, g.clientName)}>Follow All</Button>}
                            <Button variant="accent" size="sm" onClick={() => setDetailGroupKey(key)}>Details</Button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className={styles.childHeadRow}>
                            <td /><td />
                            <th>Container</th>
                            <th style={{ textAlign: 'center' }}>Invoice No.</th>
                            <th>Size / Type</th>
                            <th style={{ textAlign: 'center' }}>Month</th>
                            <th>Location</th>
                            {isPending ? (
                              <th style={{ textAlign: 'center' }}>Days / Ageing</th>
                            ) : (
                              <>
                                <th style={{ textAlign: 'right' }}>Payment Date</th>
                                <th>UTR / Detail</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                              </>
                            )}
                            <th style={{ textAlign: 'center' }}>Action</th>
                          </tr>
                        )}
                        {expanded && g.containers.map((ct) => (
                          <ContainerChildRow
                            key={ct._idx}
                            ct={ct}
                            isPending={isPending}
                            canRecv={canRecv}
                            selected={selectedContainers.has(ct.row[0])}
                            onToggleSelect={() => toggleContainer(ct.row[0])}
                            onPay={() => onOpenPaymentSingle(ct.row[0])}
                            onViewLog={() => onViewFollowUpLog([{ container: ct.row[0], dates: ct.logV, remarks: ct.logW, users: ct.logX }])}
                            onViewPayLog={() => onViewPaymentLog(ct)}
                          />
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContainerChildRow({ ct, isPending, canRecv, selected, onToggleSelect, onPay, onViewLog, onViewPayLog }) {
  const hasLog = ct.logV && ct.logV.trim() !== '';
  const hasPayLog = ct.payLogV && ct.payLogV.trim() !== '';
  return (
    <tr className={styles.childRow}>
      {canRecv && isPending ? (
        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={!!ct.disputeStatus} title={ct.disputeStatus ? 'Disputed — excluded from bulk payment' : ''} />
        </td>
      ) : <td />}
      <td />
      <td className={styles.containerCell}>{ct.row[0]}</td>
      <td style={{ textAlign: 'center' }}>{ct.invoiceNo || <span className={styles.dim}>-</span>}</td>
      <td className={styles.dimText}>{ct.row[5]} / {ct.row[6]}</td>
      <td style={{ textAlign: 'center' }} className={styles.dimText}>{renderCellValue(ct.row[10])} {renderCellValue(ct.row[11])}</td>
      {isPending ? (
        <>
          <td className={styles.dimText}>{ct.row[15]}</td>
          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
            <span className={bandTextClass(ct.band)}>{typeof ct.daysLeft === 'number' ? `${ct.daysLeft} days` : '-'}</span>{' '}
            {ct.band && <span className={bandBadgeClass(ct.band)}>{ct.band}</span>}
          </td>
        </>
      ) : (
        <>
          <td className={styles.dimText}>{ct.row[12]}</td>
          <td style={{ textAlign: 'right' }} className={styles.dimText}>{ct.row[ct.row.length - 4] || '-'}</td>
          <td className={styles.dimText} title={ct.row[ct.row.length - 3] || ''}>{ct.row[ct.row.length - 3] || '-'}</td>
          <td style={{ textAlign: 'center' }}><span className={styles.paidText}>✓ Paid</span></td>
        </>
      )}
      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        {hasLog && <Button variant="secondary" size="sm" onClick={onViewLog}>Log</Button>}
        {hasPayLog && <Button variant="secondary" size="sm" onClick={onViewPayLog}>Pay Log</Button>}
        {canRecv && isPending && <Button variant="accent" size="sm" onClick={onPay}>Pay</Button>}
        {ct.disputeStatus && <span className={styles.disputedBadge}>Disputed</span>}
      </td>
    </tr>
  );
}

function LeaseGroupDetail({ group, isInv, isPending, canRecv, onBack, onOpenFollowUp, onOpenPaymentSingle, onViewFollowUpLog, onViewPaymentLog }) {
  const anyLog = group.containers.some((c) => c.logV && c.logV.trim() !== '');
  return (
    <div>
      <Button variant="primary" size="sm" onClick={onBack} className={styles.backBtn}>← Back to List</Button>
      <div className={styles.detailCard}>
        <div className={styles.detailHeader}>
          <div>
            <h4>{isInv ? (group.invoiceNo || 'No Invoice') : group.clientName}</h4>
            <span className={styles.custCode}>{group.clientCode} · {group.containerCount} Containers</span>
          </div>
          {!isPending && <span className={styles.badgeSafe}>✓ Payment Received</span>}
        </div>
        <div className={styles.detailToolbar}>
          {anyLog && <Button variant="secondary" size="sm" onClick={() => onViewFollowUpLog(group.containers.map((c) => ({ container: c.row[0], dates: c.logV, remarks: c.logW, users: c.logX })))}>Follow-up Log (All)</Button>}
          {canRecv && isPending && <Button variant="primary" size="sm" onClick={onOpenFollowUp}>+ Follow Up All Containers</Button>}
        </div>

        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr className={styles.detailTableHead}>
              <th>Container</th>
              <th style={{ textAlign: 'center' }}>Invoice No.</th>
              <th>Location</th>
              {isPending ? <><th>Days</th><th>Ageing</th></> : <><th>Payment Date</th><th>UTR</th></>}
              <th style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {group.containers.map((ct) => (
              <tr key={ct._idx} style={{ borderTop: '1px solid var(--line)' }}>
                <td className={styles.containerCell}>{ct.row[0]}</td>
                <td style={{ textAlign: 'center' }}>{ct.invoiceNo || '-'}</td>
                <td className={styles.dimText}>{ct.row[15]}</td>
                {isPending ? (
                  <>
                    <td className={bandTextClass(ct.band)}>{typeof ct.daysLeft === 'number' ? `${ct.daysLeft} days` : '-'}</td>
                    <td>{ct.band ? <span className={bandBadgeClass(ct.band)}>{ct.band}</span> : '-'}</td>
                  </>
                ) : (
                  <>
                    <td className={styles.dimText}>{ct.row[ct.row.length - 4] || '-'}</td>
                    <td className={styles.dimText}>{ct.row[ct.row.length - 3] || '-'}</td>
                  </>
                )}
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {ct.logV && ct.logV.trim() !== '' && <Button variant="secondary" size="sm" onClick={() => onViewFollowUpLog([{ container: ct.row[0], dates: ct.logV, remarks: ct.logW, users: ct.logX }])}>Log</Button>}
                  {ct.payLogV && ct.payLogV.trim() !== '' && <Button variant="secondary" size="sm" onClick={() => onViewPaymentLog(ct)}>Pay Log</Button>}
                  {canRecv && isPending && <Button variant="accent" size="sm" onClick={() => onOpenPaymentSingle(ct.row[0])}>Pay</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =====================================================================
   CATEGORY — Sale / Accessories / Transportion / AMC / Other (flat list)
===================================================================== */
function CategorySection(props) {
  const {
    category, data, loading, error, onRetry, isPending, search, setSearch,
    clientCodeFilter, setClientCodeFilter, clientNameFilter, setClientNameFilter,
    detailRowNum, setDetailRowNum, canRecv, onOpenFollowUp, onOpenPayment, onViewFollowUpLog, onViewPaymentLog
  } = props;

  const headers = data?.headers || [];
  const visibleIdx = visibleHeaderIndexes(headers);
  const items = data?.data || [];

  const filtered = useMemo(() => {
    let list = filterRows(items, search);
    if (clientCodeFilter) list = list.filter((it) => (it.row[1] || '') === clientCodeFilter);
    if (clientNameFilter) list = list.filter((it) => (it.row[2] || '') === clientNameFilter);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, clientCodeFilter, clientNameFilter]);

  const clientOptions = useMemo(() => {
    const codes = new Map();
    const names = new Map();
    for (const it of items) {
      if (it.row[1]) codes.set(it.row[1], true);
      if (it.row[2]) names.set(it.row[2], true);
    }
    return { codes: [...codes.keys()], names: [...names.keys()] };
  }, [items]);

  if (data?.missing) {
    return <p className={styles.hint}>Sheet not found — create a sheet named "{data.sheetName}"</p>;
  }

  const detailItem = detailRowNum != null ? filtered.find((it) => it._rowNum === detailRowNum) : null;

  return (
    <div>
      <div className={styles.ctrlBar}>
        <input type="text" className={styles.search} placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <input type="text" list="catClientCodeList" className={styles.filterInput} placeholder="Search Client Code..." value={clientCodeFilter} onChange={(e) => setClientCodeFilter(e.target.value)} />
        <datalist id="catClientCodeList">{clientOptions.codes.map((c) => <option key={c} value={c} />)}</datalist>
        <input type="text" list="catClientNameList" className={styles.filterInput} placeholder="Search Client Name..." value={clientNameFilter} onChange={(e) => setClientNameFilter(e.target.value)} />
        <datalist id="catClientNameList">{clientOptions.names.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

      {detailItem ? (
        <CategoryDetail
          item={detailItem}
          headers={headers}
          visibleIdx={visibleIdx}
          category={category}
          isPending={isPending}
          canRecv={canRecv}
          total={filtered.length}
          onBack={() => setDetailRowNum(null)}
          onOpenFollowUp={() => onOpenFollowUp(detailItem._rowNum)}
          onOpenPayment={() => onOpenPayment(detailItem._rowNum)}
          onViewFollowUpLog={() => onViewFollowUpLog(detailItem)}
          onViewPaymentLog={() => onViewPaymentLog(detailItem)}
        />
      ) : (
        <>
          <p className={styles.hint}>👉 Click row for details · Use buttons for quick action</p>
          <DataTable
            headers={[...visibleIdx.map((i) => headers[i]), ...(isPending ? ['Days', 'Ageing'] : [])]}
            rows={filtered}
            loading={loading}
            error={error}
            onRetry={onRetry}
            emptyMessage="No records found"
            rowKey={(r) => r._rowNum}
            renderRow={(values, item) => (
              <>
                {visibleIdx.map((ci, i) => (
                  <td key={ci} style={i === 0 ? { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px', cursor: 'pointer' } : { cursor: 'pointer' }} onClick={() => setDetailRowNum(item._rowNum)}>
                    {renderCellValue(values[ci])}
                  </td>
                ))}
                {isPending && (
                  <>
                    <td className={bandTextClass(item.band)}>{typeof item.daysLeft === 'number' ? `${item.daysLeft} days` : '-'}</td>
                    <td>{item.band ? <span className={bandBadgeClass(item.band)}>{item.band}</span> : '-'}</td>
                  </>
                )}
              </>
            )}
            renderActions={(item) => {
              const hasLog = item.logV && item.logV.trim() !== '';
              const hasPayLog = item.payLogV && item.payLogV.trim() !== '';
              return (
                <>
                  {hasLog && <Button variant="secondary" size="sm" onClick={() => onViewFollowUpLog(item)}>Log</Button>}
                  {canRecv && isPending && <Button variant="primary" size="sm" onClick={() => onOpenFollowUp(item._rowNum)}>Follow</Button>}
                  {hasPayLog && <Button variant="secondary" size="sm" onClick={() => onViewPaymentLog(item)}>Pay Log</Button>}
                  {canRecv && isPending && <Button variant="accent" size="sm" onClick={() => onOpenPayment(item._rowNum)}>Pay</Button>}
                  {!canRecv && !hasLog && <span className={styles.viewOnlyIcon}>👁</span>}
                </>
              );
            }}
          />
        </>
      )}
    </div>
  );
}

function CategoryDetail({ item, headers, visibleIdx, category, isPending, canRecv, total, onBack, onOpenFollowUp, onOpenPayment, onViewFollowUpLog, onViewPaymentLog }) {
  const hasFollowLog = item.logV && item.logV.trim() !== '';
  const hasPayLog = item.payLogV && item.payLogV.trim() !== '';
  return (
    <div>
      <Button variant="primary" size="sm" onClick={onBack} className={styles.backBtn}>← Back to List ({total})</Button>
      <div className={styles.detailCard}>
        <div className={styles.detailHeader}>
          <div>
            <h4>{item.row[0]}</h4>
            <span className={styles.custCode}>{category}</span>
          </div>
          {isPending
            ? <span className={bandBadgeClass(item.band)}>{item.band || '-'} · {typeof item.daysLeft === 'number' ? `${item.daysLeft} days` : '-'}</span>
            : <span className={styles.badgeSafe}>Payment Received</span>}
        </div>

        <div className={styles.detailGrid}>
          {visibleIdx.map((ci) => (
            <div key={ci} className={styles.detailField}>
              <div className={styles.detailLabel}>{headers[ci] || `Col ${ci + 1}`}</div>
              <div className={styles.detailValue}>{item.row[ci]}</div>
            </div>
          ))}
        </div>

        <div className={styles.detailFooter}>
          <div className={styles.detailFooterActions}>
            {hasFollowLog && <Button variant="secondary" size="sm" onClick={onViewFollowUpLog}>Follow-up Log</Button>}
            {canRecv && isPending && <Button variant="primary" size="sm" onClick={onOpenFollowUp}>+ Follow Up</Button>}
            {hasPayLog && <Button variant="secondary" size="sm" onClick={onViewPaymentLog}>Payment Log</Button>}
          </div>
          {canRecv && isPending
            ? <Button variant="accent" size="lg" onClick={onOpenPayment}>$ Record Payment</Button>
            : !isPending
              ? <span className={styles.paidText}>✓ Completed</span>
              : <span className={styles.viewOnlyIcon}>👁 View Only</span>}
        </div>
      </div>
    </div>
  );
}
