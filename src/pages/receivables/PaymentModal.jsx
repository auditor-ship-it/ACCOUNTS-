import { useEffect, useState } from 'react';
import { Modal } from '../../components/common/Modal.jsx';
import { Button } from '../../components/common/Button.jsx';
import { FileUpload } from '../../components/common/FileUpload.jsx';
import { validateUpload } from '../../utils/billingDisplay.js';

/**
 * Port of the shared #paymentModal (LMS!.html ~4652 + savePayment()). Reused
 * for every payment context — single Lease/Transport/Category row and the
 * Lease bulk-payment flow — the original used the exact same modal/fields for
 * all of them, branching only on `paymentModalContext` at save time.
 *
 * Client-side validation mirrors savePayment() exactly:
 *   - UTR / Reference is always required.
 *   - Amount is OPTIONAL here — if left blank the original still submits it
 *     (blank), and each backend endpoint decides what blank means: single-row
 *     payment endpoints reject a blank/non-positive amount server-side
 *     ("Payment amount is required and must be greater than zero"), while the
 *     bulk endpoint treats blank as "pay off this container's own remaining
 *     balance in full" per container. If an amount IS typed, it must parse to
 *     a number > 0 (checked here, matching the original's inline checks).
 *   - The attachment is optional; extension/size validated via
 *     validateUpload() (10MB ceiling, matches original's validateFile()).
 */
export function PaymentModal({ open, title = 'Record Payment', subtitle, submitting, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('');
      setUtr('');
      setRemarks('');
      setFile(null);
      setFileError('');
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleFileSelected = (payload) => {
    const result = validateUpload(payload);
    if (!result.valid) {
      setFileError(result.msg);
      setFile(null);
      return;
    }
    setFileError('');
    setFile(payload);
  };

  const amtTrim = amount.trim();
  const amtIsValid = amtTrim === '' || (!Number.isNaN(parseFloat(amtTrim)) && parseFloat(amtTrim) > 0);
  const canSubmit = utr.trim() !== '' && amtIsValid && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      amount: amtTrim === '' ? '' : parseFloat(amtTrim),
      utr: utr.trim(),
      remarks: remarks.trim(),
      file // {base64Data, mimeType, fileName} | null
    });
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
          <Button variant="accent" onClick={handleSubmit} loading={submitting} disabled={!canSubmit}>
            Save Payment
          </Button>
        </>
      )}
    >
      {subtitle && <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>{subtitle}</p>}

      <FieldLabel>Amount</FieldLabel>
      <TextInput
        value={amount}
        onChange={setAmount}
        placeholder="Enter amount (leave blank to pay remaining balance in full)"
        autoFocus={false}
      />
      {!amtIsValid && <FieldError>Invalid amount — must be a number greater than zero</FieldError>}

      <FieldLabel>UTR / Reference *</FieldLabel>
      <TextInput value={utr} onChange={setUtr} placeholder="UTR or Reference No" />

      <FieldLabel>Remarks</FieldLabel>
      <TextInput value={remarks} onChange={setRemarks} placeholder="Optional" />

      <FieldLabel>Attachment (optional)</FieldLabel>
      <FileUpload label="Choose proof of payment" onSelected={handleFileSelected} accept=".pdf,.jpg,.jpeg,.png,.gif,.xls,.xlsx" />
      {fileError && <FieldError>{fileError}</FieldError>}
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
        Only PDF, Images, and Excel files. Max 10MB.
      </p>
    </Modal>
  );
}

function FieldLabel({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
      color: 'var(--text-3)', marginTop: 14, marginBottom: 6
    }}
    >
      {children}
    </label>
  );
}

function FieldError({ children }) {
  return <p style={{ color: 'var(--error)', fontSize: 12, fontWeight: 600, marginTop: 6 }}>{children}</p>;
}

function TextInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <input
      type="text"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--text)', background: 'var(--surface)'
      }}
    />
  );
}
