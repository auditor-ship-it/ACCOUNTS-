import { Routes, Route } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext.jsx';
import { RequireAuth } from './components/layout/RequireAuth.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { IconSprite } from './components/ui/IconSprite.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { BillingPage } from './pages/billing/BillingPage.jsx';
import { PendingBillingPage } from './pages/pendingBilling/PendingBillingPage.jsx';
import { ReceivablesPage } from './pages/receivables/ReceivablesPage.jsx';
import { MonthlyStatementPage } from './pages/monthlyStatement/MonthlyStatementPage.jsx';
import { OutstandingViewPage } from './pages/outstandingView/OutstandingViewPage.jsx';
import { DeployedSummaryPage } from './pages/deployedSummary/DeployedSummaryPage.jsx';
import { MonthlyReportPage } from './pages/monthlyReport/MonthlyReportPage.jsx';
import { BillingApprovalPage } from './pages/billingApproval/BillingApprovalPage.jsx';
import { DisputeApprovalPage } from './pages/disputeApproval/DisputeApprovalPage.jsx';
import { ApprovalSummaryPage } from './pages/approvalSummary/ApprovalSummaryPage.jsx';

export default function App() {
  return (
    <ToastProvider>
      <IconSprite />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={(
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          )}
        >
          <Route index element={<BillingPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="pending-billing" element={<PendingBillingPage />} />
          <Route path="receivables" element={<ReceivablesPage />} />
          <Route path="statement" element={<MonthlyStatementPage />} />
          <Route path="outstanding" element={<OutstandingViewPage />} />
          <Route path="deployed-summary" element={<DeployedSummaryPage />} />
          <Route path="report" element={<MonthlyReportPage />} />
          <Route path="billing-approval" element={<BillingApprovalPage />} />
          <Route path="dispute-approval" element={<DisputeApprovalPage />} />
          <Route path="approval-summary" element={<ApprovalSummaryPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
