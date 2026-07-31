import styles from './DataTable.module.css';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { EmptyState, ErrorState } from './EmptyState.jsx';
import { renderCellValue } from './CellValue.jsx';

/**
 * Generic data grid — consolidates the original's under-used buildTable()
 * helper plus the heavy per-section custom table markup (renderVerify,
 * renderBilling, renderReceivables, etc. each built their own HTML strings)
 * into one reusable component every page can share.
 */
export function DataTable({
  headers = [],
  rows = [],
  renderRow, // optional: (rowValues, rowMeta, index) => ReactNode[] of <td> cells, for custom cell rendering
  renderActions, // optional: (rowMeta, index) => ReactNode, rendered as a trailing "Actions" column
  loading,
  error,
  onRetry,
  emptyMessage = 'No records found',
  selectable,
  selectedKeys,
  onToggleSelect,
  rowKey = (r, i) => r._rowNum ?? i
}) {
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return <EmptyState message={emptyMessage} />;

  return (
    <div className={styles.scrollWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {selectable && <th className={styles.checkboxCol} />}
            {headers.map((h, i) => <th key={i}>{h}</th>)}
            {renderActions && <th className={styles.actionsCol}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const values = r.row || r;
            const key = rowKey(r, i);
            return (
              <tr key={key}>
                {selectable && (
                  <td className={styles.checkboxCol}>
                    <input
                      type="checkbox"
                      checked={!!selectedKeys?.has(key)}
                      onChange={() => onToggleSelect?.(key, r)}
                    />
                  </td>
                )}
                {renderRow
                  ? renderRow(values, r, i)
                  : values.map((v, ci) => <td key={ci}>{renderCellValue(v)}</td>)}
                {renderActions && <td className={styles.actionsCol}>{renderActions(r, i)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
