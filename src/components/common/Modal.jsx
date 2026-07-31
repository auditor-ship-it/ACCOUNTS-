import styles from './Modal.module.css';

export function Modal({ open, onClose, title, children, footer, width }) {
  if (!open) return null;
  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={styles.modal} style={width ? { maxWidth: width } : undefined}>
        <div className={styles.header}>
          <h3>{title}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
