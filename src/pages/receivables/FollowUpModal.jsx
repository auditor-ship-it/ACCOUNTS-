import { useEffect, useState } from 'react';
import { Modal } from '../../components/common/Modal.jsx';
import { Button } from '../../components/common/Button.jsx';

/**
 * Port of the shared #followUpModal (LMS!.html ~4761 + confirmFollowUp()).
 * A single remarks textarea reused for every follow-up context (per-container
 * Lease follow-up is not exposed in the original UI — only client-level
 * "Follow All" — and per-row category/transport follow-up). Remarks are
 * required, matching confirmFollowUp()'s `if (!r) { showToast('Enter
 * remarks', 'error'); return; }`.
 */
export function FollowUpModal({ open, title = 'Add Follow-up', subtitle, submitting, onClose, onSubmit }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (open) setRemarks('');
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    const r = remarks.trim();
    if (!r) return;
    onSubmit(r);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      width="480px"
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!remarks.trim()}>
            Save Follow-up
          </Button>
        </>
      )}
    >
      {subtitle && (
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>{subtitle}</p>
      )}
      <textarea
        autoFocus
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Remarks (required)"
        rows={4}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: 'var(--text)', background: 'var(--surface)'
        }}
      />
    </Modal>
  );
}
