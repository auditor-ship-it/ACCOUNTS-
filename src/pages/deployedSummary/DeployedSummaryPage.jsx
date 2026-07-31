import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader.jsx';
import { Card } from '../../components/common/Card.jsx';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { EmptyState, ErrorState } from '../../components/common/EmptyState.jsx';
import { RefreshButton } from '../../components/common/RefreshButton.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getDeployedSummary } from '../../api/dashboard.api.js';
import { DeployedDetailPanel } from './DeployedDetailPanel.jsx';
import styles from './DeployedSummaryPage.module.css';

const GROUPS = [
  { key: 'opening', label: 'Opening Deployed' },
  { key: 'addition', label: 'Addition', sep: true },
  { key: 'deletion', label: 'Deletion', sep: true },
  { key: 'net', label: 'Net Movement', sep: true },
  { key: 'closing', label: 'Closing Deployed', sep: true }
];

/**
 * Reads one summary cell out of a Deployed Summary row.
 * Port of getVal() (LMS!.html ~9267), adapted to the actual response shape
 * from getDeployedSummaryData (backend/src/services/dashboard.service.js):
 * row[category][type] is a plain number (not `{total}` — that was the
 * original GAS shape), and per-size breakdowns live only under `row._sz`.
 */
function getVal(row, category, typeVal, sizeVal, types) {
  if (!row || !row[category]) return 0;
  if (!typeVal && !sizeVal) return row[category].total || 0;
  if (typeVal && !sizeVal) return row[category][typeVal] || 0;
  if (typeVal && sizeVal) {
    return (row._sz && row._sz[category] && row._sz[category][typeVal] && row._sz[category][typeVal][sizeVal]) || 0;
  }
  let total = 0;
  for (const t of types || []) {
    total += (row._sz && row._sz[category] && row._sz[category][t] && row._sz[category][t][sizeVal]) || 0;
  }
  return total;
}

export function DeployedSummaryPage() {
  const { data, loading, error, reload } = useAsync(getDeployedSummary, []);
  const [typeVal, setTypeVal] = useState('');
  const [sizeVal, setSizeVal] = useState('');
  const [selection, setSelection] = useState(null); // { monthIdx, category, monthLabel, typeVal, sizeVal }

  const sizeOptions = useMemo(() => {
    if (!data) return [];
    if (typeVal && data.typeSizes && data.typeSizes[typeVal]) return data.typeSizes[typeVal];
    return data.sizes || [];
  }, [data, typeVal]);

  if (loading) return (<><PageHeader title="Deployed Summary" subtitle="Month-wise deployed container movement" /><Card><LoadingSpinner label="Loading deployed summary..." /></Card></>);
  if (error) return (<><PageHeader title="Deployed Summary" subtitle="Month-wise deployed container movement" /><Card><ErrorState message={error} onRetry={reload} /></Card></>);
  if (!data || !data.months || data.months.length === 0) {
    return (<><PageHeader title="Deployed Summary" subtitle="Month-wise deployed container movement" /><Card><EmptyState message="No deployed data found" /></Card></>);
  }

  const { months, rows, types } = data;
  // months[0] / rows[0] is the current (most recent) month — getDeployedSummaryData
  // builds both arrays newest-first (months.reverse() in the service).
  const currentRow = rows[0];

  const onTypeChange = (v) => {
    setTypeVal(v);
    setSizeVal('');
    setSelection(null);
  };
  const onSizeChange = (v) => {
    setSizeVal(v);
    setSelection(null);
  };

  const label = typeVal && sizeVal ? `${typeVal} — ${sizeVal}` : typeVal ? typeVal : sizeVal ? `Size: ${sizeVal}` : 'All Containers';

  const cellClass = (key, val) => {
    if (key === 'addition' && val > 0) return styles.pos;
    if (key === 'deletion' && val > 0) return styles.neg;
    if (val === 0) return styles.zero;
    if (key === 'net' && val < 0) return styles.neg;
    return '';
  };

  const onCellClick = (monthIdx, category) => {
    setSelection({ monthIdx, category, monthLabel: months[monthIdx], typeVal, sizeVal });
  };

  return (
    <>
      <PageHeader
        title="Deployed Summary"
        subtitle="Month-wise deployed container movement"
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className={styles.kpiGrid}>
        <div className={`${styles.kpiCard} ${styles.tintNavy}`}>
          <div className={styles.kpiLabel}>Currently Deployed</div>
          <div className={styles.kpiValue}>{getVal(currentRow, 'closing', typeVal, sizeVal, types)}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintInfo}`}>
          <div className={styles.kpiLabel}>{currentRow.month} Addition</div>
          <div className={styles.kpiValue}>{getVal(currentRow, 'addition', typeVal, sizeVal, types)}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintError}`}>
          <div className={styles.kpiLabel}>{currentRow.month} Deletion</div>
          <div className={styles.kpiValue}>{getVal(currentRow, 'deletion', typeVal, sizeVal, types)}</div>
        </div>
        <div className={`${styles.kpiCard} ${styles.tintSuccess}`}>
          <div className={styles.kpiLabel}>{currentRow.month} Net</div>
          <div className={styles.kpiValue}>{getVal(currentRow, 'net', typeVal, sizeVal, types)}</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label htmlFor="dsTypeFilter">Type</label>
        <select id="dsTypeFilter" value={typeVal} onChange={(e) => onTypeChange(e.target.value)}>
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label htmlFor="dsSizeFilter">Size</label>
        <select id="dsSizeFilter" value={sizeVal} onChange={(e) => onSizeChange(e.target.value)}>
          <option value="">All Sizes</option>
          {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className={styles.activeLabel}>{label}</span>
      </div>

      <div className={styles.sectionTitle}>Month-wise Movement</div>
      <div className={styles.tableWrap}>
        <table className={styles.dsTable} style={{ minWidth: 200 + months.length * 100 }}>
          <thead>
            <tr>
              <th>Category</th>
              {months.map((m) => <th key={m}>{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((grp) => (
              <tr key={grp.key} className={grp.sep ? styles.rowSep : ''}>
                <td>{grp.label}</td>
                {months.map((m, mIdx) => {
                  const val = getVal(rows[mIdx], grp.key, typeVal, sizeVal, types);
                  const isSelected = selection && selection.monthIdx === mIdx && selection.category === grp.key;
                  return (
                    <td key={m} className={isSelected ? styles.highlight : ''}>
                      <button type="button" className={`${styles.cellBtn} ${cellClass(grp.key, val)}`} onClick={() => onCellClick(mIdx, grp.key)}>
                        {val}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeployedDetailPanel selection={selection} onClose={() => setSelection(null)} />
    </>
  );
}
