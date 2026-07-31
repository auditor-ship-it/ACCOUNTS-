import styles from './BillingMonthTabs.module.css';

/**
 * Port of the Billing Sales FY dropdown + Apr–Mar month tab strip
 * (LMS!.html ~7129-7195, buildBillingFyAndTabs). Only rendered when at
 * least one row in the current category has a detectable billing month
 * (billMonthFilterActive in the original).
 */
export function BillingMonthTabs({ fy, fys, onFyChange, months, currentMonth, onMonthChange, have }) {
  return (
    <div className={styles.bar}>
      <select className={styles.fySelect} value={fy} onChange={(e) => onFyChange(e.target.value)}>
        {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
      </select>
      <div className={styles.tabs}>
        {months.map((m) => {
          const count = have[m];
          return (
            <button
              key={m}
              type="button"
              className={`${styles.tab} ${m === currentMonth ? styles.tabActive : ''}`}
              onClick={() => onMonthChange(m)}
            >
              {m}{count ? `(${count})` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
