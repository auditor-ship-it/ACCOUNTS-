import { useState } from 'react';
import { Modal } from '../../components/common/Modal.jsx';
import { Button } from '../../components/common/Button.jsx';
import { FileUpload } from '../../components/common/FileUpload.jsx';
import { validateUpload } from '../../utils/billingDisplay.js';

/**
 * Port of the "billingModal" invoice-upload dialog (LMS!.html ~saveBilling,
 * openBillingFromList/openBillingFromDetail, bulkBillingOpen). Handles both
 * the per-row single-action flow and the bulk (multi-select) flow — the
 * original reused the exact same modal/fields for both, branching only on
 * `selectedBillingRows.size > 0` at save time; this component mirrors that.
 */
export function BillingUploadModal({ open, mode, containerLabel, count, busy, onClose, onSubmit }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [file, setFile] = useState(null); // {base64Data, mimeType, fileName}

  const handleClose = () => {
    if (busy) return;
    setInvoiceNo('');
    setFile(null);
    onClose();
  };

  const handleSubmit = () => {
    const inv = invoiceNo.trim();
    if (!file) return; // FileUpload result required — mirrors "Select a file" check
    if (!inv) return; // mirrors "Invoice No. is required" check
    const result = validateUpload(file);
    if (!result.valid) return;
    onSubmit({ invoiceNo: inv, ext: result.ext, ...file });
  };

  const inv = invoiceNo.trim();
  const validation = file ? validateUpload(file) : null;
  const canSubmit = !!file && !!inv && (!validation || validation.valid) && !busy;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={mode === 'bulk' ? 'Bulk Upload Invoice' : 'Upload Invoice'}
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
            Upload
          </Button>
        </>
      )}
    >
      {mode === 'bulk' ? (
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
          📦 {count} container(s) selected — the same invoice no. and attachment will be applied to all of them.
        </p>
      ) : (
        containerLabel && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            Uploading for <strong style={{ color: 'var(--text)' }}>{containerLabel}</strong>
          </p>
        )
      )}

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', marginBottom: 6 }}>
        Invoice No.
      </label>
      <input
        type="text"
        value={invoiceNo}
        onChange={(e) => setInvoiceNo(e.target.value)}
        placeholder="Invoice number"
        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}
      />

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', marginBottom: 6 }}>
        Attachment
      </label>
      <FileUpload label="Choose invoice file" onSelected={setFile} accept=".pdf,.jpg,.jpeg,.png,.gif,.xls,.xlsx" />
      {validation && !validation.valid && (
        <p style={{ color: 'var(--error)', fontSize: 12, fontWeight: 600, marginTop: 8 }}>{validation.msg}</p>
      )}
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
        Only PDF, Images, and Excel files. Max 10MB.
      </p>
    </Modal>
  );
}
