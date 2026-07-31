import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';

export function ConfirmDialog({ open, title = 'Please confirm', message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="420px"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      <p style={{ fontSize: 14, color: 'var(--text-2)' }}>{message}</p>
    </Modal>
  );
}
