import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { ErrorState } from '../../components/common/EmptyState.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getMonthlyReport } from '../../api/dashboard.api.js';
import styles from './MonthlyReportPage.module.css';

const inr = (v) => (v === '' || v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const pct = (v) => (v === '' || v == null ? '—' : `${v}%`);
const num = (v) => (v === '' || v == null ? '—' : v);

function Kpi({ label, value, tone }) {
  return (
    <div className={styles.kpiTile}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${tone ? styles[tone] : ''}`}>{value}</div>
    </div>
  );
}

const INSIGHT_ICON = { good: '✅', warn: '⚠️', bad: '🔴' };

/** Port of the "Monthly Report"/MIS report suite (LMS!.html ~5785-5910, getReportSuiteData/getMonthlyReportData). */
export function MonthlyReportPage() {
  const { data, loading, error, reload } = useAsync(getMonthlyReport, []);

  if (loading) return <LoadingSpinner label="Building report…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const {
    generatedOn, generatedBy, insights = [], arAgingFine = [],
    newLeasePending = {}, deploymentSla = {}, billingException = {},
    arAging = {}, collectionEff = {}, revenue = {}, renewalPipeline = {},
    offLease = {}, cfo = {}, ceo = {}
  } = data;

  return (
    <>
      <PageHeader
        title="Monthly Report"
        subtitle="MIS / CFO / CEO report suite"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className={styles.metaBar}>
        <span>Generated on <strong>{generatedOn}</strong></span>
        <span>By <strong>{generatedBy}</strong></span>
      </div>

      <h3 className={styles.sectionTitle}>Business Insights</h3>
      <Card>
        <div className={styles.insightList}>
          {insights.map((ins, i) => (
            <div key={i} className={`${styles.insightRow} ${styles[ins.level] || ''}`}>
              <span className={styles.insightIcon}>{INSIGHT_ICON[ins.level] || 'ℹ️'}</span>
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <h3 className={styles.sectionTitle}>CEO Summary</h3>
      <Card>
        <div className={styles.kpiGrid}>
          <Kpi label="Active Contracts" value={num(ceo.activeContracts)} />
          <Kpi label="Revenue" value={inr(ceo.revenue)} />
          <Kpi label="Growth vs Last Month" value={pct(ceo.growth)} tone={ceo.growth > 0 ? 'green' : ceo.growth < 0 ? 'red' : ''} />
          <Kpi label="Renewal Rate" value={pct(ceo.renewalRate)} />
          <Kpi label="Collection %" value={pct(ceo.collection)} tone={ceo.collection >= 80 ? 'green' : ceo.collection >= 50 ? 'amber' : 'red'} />
          <Kpi label="90+ Days Overdue" value={inr(ceo.overdue90)} tone={ceo.overdue90 ? 'red' : ''} />
          <Kpi label="Health Score" value={num(ceo.health)} tone={ceo.health >= 70 ? 'green' : ceo.health >= 40 ? 'amber' : 'red'} />
        </div>
      </Card>

      <h3 className={styles.sectionTitle}>CFO Summary</h3>
      <Card>
        <div className={styles.kpiGrid}>
          <Kpi label="Revenue" value={inr(cfo.revenue)} />
          <Kpi label="Outstanding" value={inr(cfo.outstanding)} />
          <Kpi label="Collection %" value={pct(cfo.collection)} />
          <Kpi label="DSO (days)" value={num(cfo.dso)} />
          <Kpi label="Revenue at Risk (90+)" value={inr(cfo.revenueAtRisk)} tone={cfo.revenueAtRisk ? 'red' : ''} />
        </div>
      </Card>

      <div className={styles.cardGrid}>
        <Card title="New Lease Pending">
          <div className={styles.kpiGrid}>
            <Kpi label="Total" value={num(newLeasePending.count)} />
            <Kpi label="Verify" value={num(newLeasePending.verify)} />
            <Kpi label="Approve" value={num(newLeasePending.approve)} />
          </div>
        </Card>

        <Card title="Deployment SLA">
          <div className={styles.kpiGrid}>
            <Kpi label="Deployed" value={num(deploymentSla.deployed)} />
            <Kpi label="Within SLA" value={num(deploymentSla.withinSla)} />
            <Kpi label="Breached" value={num(deploymentSla.breached)} />
          </div>
          {deploymentSla.note && <p className={styles.note}>{deploymentSla.note}</p>}
        </Card>

        <Card title="Billing Exceptions">
          <div className={styles.kpiGrid}>
            <Kpi label="Exceptions" value={num(billingException.exceptions)} tone={billingException.exceptions ? 'amber' : ''} />
          </div>
          {billingException.note && <p className={styles.note}>{billingException.note}</p>}
        </Card>

        <Card title="Renewal Pipeline">
          <div className={styles.kpiGrid}>
            <Kpi label="Expiring 30d" value={num(renewalPipeline.exp30)} tone={renewalPipeline.exp30 ? 'amber' : ''} />
            <Kpi label="Expiring 60d" value={num(renewalPipeline.exp60)} />
            <Kpi label="Expiring 90d" value={num(renewalPipeline.exp90)} />
            <Kpi label="Expired" value={num(renewalPipeline.expired)} tone={renewalPipeline.expired ? 'red' : ''} />
            <Kpi label="Renewed" value={num(renewalPipeline.renewed)} tone="green" />
            <Kpi label="Renewal Rate" value={pct(renewalPipeline.renewalRate)} />
          </div>
        </Card>

        <Card title="Off-Lease">
          <div className={styles.kpiGrid}>
            <Kpi label="Open" value={num(offLease.open)} />
            <Kpi label="Approval Pending" value={num(offLease.approvalPending)} tone={offLease.approvalPending ? 'amber' : ''} />
          </div>
        </Card>

        <Card title="AR Ageing">
          <div className={styles.kpiGrid}>
            <Kpi label="0-30 Days" value={inr(arAging.b0)} />
            <Kpi label="31-60 Days" value={inr(arAging.b1)} />
            <Kpi label="61-90 Days" value={inr(arAging.b2)} />
            <Kpi label="90+ Days" value={inr(arAging.b3)} tone={arAging.b3 ? 'red' : ''} />
          </div>
        </Card>
      </div>

      <h3 className={styles.sectionTitle}>AR Ageing (Detailed)</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Bucket</th><th className={styles.num}>Amount</th><th className={styles.num}>Count</th></tr></thead>
          <tbody>
            {arAgingFine.map((b, i) => (
              <tr key={i}>
                <td>{b.label}</td>
                <td className={styles.num}>{inr(b.amount)}</td>
                <td className={styles.num}>{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className={styles.sectionTitle}>Monthly Collection Efficiency</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th><th className={styles.num}>Containers</th><th className={styles.num}>Billed</th>
              <th className={styles.num}>Received</th><th className={styles.num}>Outstanding</th><th className={styles.num}>Collection %</th>
            </tr>
          </thead>
          <tbody>
            {(collectionEff.months || []).map((m, i) => (
              <tr key={i}>
                <td>{m.month}</td>
                <td className={styles.num}>{m.containers}</td>
                <td className={styles.num}>{inr(m.billed)}</td>
                <td className={styles.num}>{inr(m.received)}</td>
                <td className={styles.num}>{inr(m.outstanding)}</td>
                <td className={styles.num}>{pct(m.collection)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.tfoot}>
              <td>Total</td><td className={styles.num}></td>
              <td className={styles.num}>{inr(collectionEff.totalBilled)}</td>
              <td className={styles.num}>{inr(collectionEff.totalReceived)}</td>
              <td className={styles.num}>{inr(collectionEff.totalOutstanding)}</td>
              <td className={styles.num}>{pct(collectionEff.collection)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className={styles.sectionTitle}>Revenue</h3>
      <Card>
        <div className={styles.kpiGrid}>
          <Kpi label="Total Revenue" value={inr(revenue.total)} />
        </div>
      </Card>
    </>
  );
}
