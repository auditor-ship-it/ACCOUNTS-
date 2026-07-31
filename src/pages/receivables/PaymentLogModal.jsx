import { Modal } from '../../components/common/Modal.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import styles from '../../components/common/LogModal.module.css';

function splitLines(s) {
  return String(s || '').split('\n').filter((x) => x.trim() !== '');
}

/**
 * Port of viewRecvCatPayLog() / viewPaymentLog() (LMS!.html ~7832 / ~8391) —
 * the 4-column "Payment History" popup (Attachment / Date / Payment Detail /
 * Recorded By), newest entry first. Distinct from the shared `LogModal`
 * (which renders the 3-column Date/Remarks/User follow-up log) because the
 * payment log carries an extra attachment column.
 *
 * The original's Date column additionally strips any line containing "GMT"
 * (a defensive filter against a raw Date.toString() slipping into the log
 * text) — ported verbatim below.
 *
 * DEVIATION (display-only, no data/validation change): the original renders
 * the Attachment cell as plain escaped text even when it is a URL. This port
 * renders it as an "open file" link when it looks like a URL (starts with
 * http), matching the link-icon convention already used elsewhere in this
 * app (e.g. dispute attachments) — a usability improvement, not a change to
 * any amount, date, or validation.
 */
export function PaymentLogModal({ open, onClose, payLogAD, payLogV, payLogW, payLogX, title = 'Payment History' }) {
  const ad = splitLines(payLogAD);
  const va = splitLines(payLogV).filter((x) => x.indexOf('GMT') === -1);
  const wa = splitLines(payLogW);
  const xa = splitLines(payLogX);
  const len = Math.max(ad.length, va.length, wa.length, xa.length);

  const rows = [];
  for (let j = len - 1; j >= 0; j--) {
    rows.push({ attachment: ad[j] || '-', date: va[j] || '-', detail: wa[j] || '-', user: xa[j] || '-' });
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width="560px">
      {!rows.length ? (
        <p className={styles.empty}>No payment logs yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                <th style={{ padding: '6px 8px' }}>Attachment</th>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Payment Detail</th>
                <th style={{ padding: '6px 8px' }}>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px' }}>
                    {r.attachment !== '-' && /^https?:\/\//i.test(r.attachment) ? (
                      <a href={r.attachment} target="_blank" rel="noopener noreferrer" title="Open file"><Icon name="external" size="sm" /></a>
                    ) : r.attachment}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-3)' }}>{r.date}</td>
                  <td style={{ padding: '8px', color: 'var(--text)', fontWeight: 600 }}>{r.detail}</td>
                  <td style={{ padding: '8px', color: 'var(--accent)' }}>{r.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
