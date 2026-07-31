import { useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '../../components/common/LoadingSpinner.jsx';
import { ErrorState } from '../../components/common/EmptyState.jsx';
import { getDeployedDetail } from '../../api/dashboard.api.js';
import { apiErrorMessage } from '../../api/client.js';
import styles from './DeployedSummaryPage.module.css';

const MOVEMENT_CLASS = { Addition: styles.mvtAdd, Deletion: styles.mvtDel };
const MOVEMENT_TEXT = { Addition: '+ Added', Deletion: '− Removed' };

/**
 * Container-level drill-down for one Deployed Summary cell. Port of
 * showDsDetail()/renderDsDetail() (LMS!.html ~9280-9342) — inline panel below
 * the summary table rather than a modal, matching the original's in-page
 * "dsDetailArea" behaviour (scrolls into view on load).
 */
export function DeployedDetailPanel({ selection, onClose }) {
  const [containers, setContainers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!selection) return;
    const myId = ++reqId.current;
    setLoading(true);
    setError('');
    getDeployedDetail(selection.monthLabel, selection.category, selection.typeVal, selection.sizeVal)
      .then((r) => {
        if (reqId.current !== myId) return;
        setContainers(r?.containers || []);
      })
      .catch((e) => {
        if (reqId.current !== myId) return;
        setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (reqId.current === myId) setLoading(false);
      });
  }, [selection]);

  useEffect(() => {
    if (!loading && containers !== null && wrapRef.current) {
      wrapRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, containers]);

  if (!selection) return null;

  const catLabel = selection.category.charAt(0).toUpperCase() + selection.category.slice(1);
  let filterLabel = selection.typeVal || 'All Types';
  if (selection.sizeVal) filterLabel += ' — ' + selection.sizeVal;

  const addCount = (containers || []).filter((c) => c.movement === 'Addition').length;
  const delCount = (containers || []).filter((c) => c.movement === 'Deletion').length;
  const existCount = (containers || []).length - addCount - delCount;

  return (
    <div className={styles.detailArea} ref={wrapRef}>
      <div className={styles.detailHeader}>
        <div>
          <h4>{selection.monthLabel} &mdash; {catLabel}</h4>
          <span className={styles.detailBadge}>{filterLabel} &middot; {(containers || []).length} containers</span>
        </div>
        <div className={styles.movementTags}>
          {addCount > 0 && <span className={`${styles.mvt} ${styles.mvtAdd}`}>+ {addCount} Added</span>}
          {delCount > 0 && <span className={`${styles.mvt} ${styles.mvtDel}`}>&minus; {delCount} Removed</span>}
          {existCount > 0 && <span className={`${styles.mvt} ${styles.mvtExist}`}>{existCount} Existing</span>}
          <button type="button" className={styles.closeBtn} onClick={onClose}>Close</button>
        </div>
      </div>

      {loading && <LoadingSpinner label="Loading details..." />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && containers && containers.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)' }}>
          No matching containers for this selection
        </div>
      )}
      {!loading && !error && containers && containers.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.dsTable}>
            <thead>
              <tr>
                <th>Container</th><th>Client Code</th><th>Client Name</th><th>Size</th>
                <th>Type</th><th>Location</th><th>Deployed Date</th><th>Valid Upto</th><th>Movement</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c, i) => (
                <tr key={c.container || i}>
                  <td style={{ textAlign: 'left', paddingLeft: 14, fontWeight: 600 }}>{c.container}</td>
                  <td style={{ textAlign: 'left' }}>{c.clientCode}</td>
                  <td style={{ textAlign: 'left' }}>{c.clientName}</td>
                  <td>{c.size}</td>
                  <td>{c.type}</td>
                  <td style={{ textAlign: 'left' }}>{c.location}</td>
                  <td>{c.deployedDate}</td>
                  <td>{c.validUpto}</td>
                  <td>
                    <span className={`${styles.mvt} ${MOVEMENT_CLASS[c.movement] || styles.mvtExist}`}>
                      {MOVEMENT_TEXT[c.movement] || 'Existing'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
