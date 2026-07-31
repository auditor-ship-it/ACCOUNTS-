/**
 * Top-level navigation for the Accounts & Collection Lease System.
 * `sidebarKey` matches the backend's SIDEBAR_KEYS (Roles & Access) — the same
 * keys the main frontend/ app already uses for these same features, so
 * existing per-user visibility settings apply here unchanged.
 * `icon` names come from the Crystal Design System's locked icon sprite
 * (see components/ui/IconSprite.jsx) — never a one-off glyph.
 */
export const NAV_ITEMS = [
  { path: '/billing', label: 'Billing Sale', sidebarKey: 'billing', icon: 'doc' },
  { path: '/pending-billing', label: 'Pending Billing', sidebarKey: 'pendingBilling', icon: 'clock' },
  { path: '/receivables', label: 'Receivable', sidebarKey: 'receivables', icon: 'inbox' },
  { path: '/statement', label: 'Monthly Statement', sidebarKey: 'statement', icon: 'calendar' },
  { path: '/outstanding', label: 'Outstanding View', sidebarKey: 'outstanding', icon: 'eye' },
  { path: '/deployed-summary', label: 'Deployed Summary', sidebarKey: 'deployedSummary', icon: 'container' },
  { path: '/report', label: 'Monthly Report', sidebarKey: 'report', icon: 'chart' },
  { path: '/billing-approval', label: 'Billing Approval', sidebarKey: 'billingApproval', icon: 'check-circle' },
  { path: '/dispute-approval', label: 'Dispute Approval', sidebarKey: 'disputeApproval', icon: 'alert' },
  { path: '/approval-summary', label: 'Approval Summary', sidebarKey: 'approvalSummary', icon: 'check' }
];
