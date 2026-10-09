# Accounts & Collection (ACCOUNTS-)

Crystal Group's Accounts & Collection app: Tally Outstanding, receivables and
follow-ups, billing and pending billing, transport billing, disputes with
approval stages, payment recording and reconciliation, dashboards.

## Stack
- Root (`src/`, `index.html`, `vite.config.js`) — React 19 + Vite frontend, oxlint.
- `backend/` — Node, Express, MongoDB + Google Sheets (`googleapis`),
  write-through and sheet pushers.

## Run & check
- Frontend: `npm ci` · `npm run dev` · `npm run lint` · `npm run build`
- Backend: `npm ci --prefix backend` · `npm run dev --prefix backend`
- CI (`.github/workflows/ci.yml`) runs lint, build and a backend syntax check.
- No test suite yet. Bug fixes must add a test or a reproducible script first.

## LIVE SYSTEM — hard rules
- Never push to `main`; always open a PR. A human merges.
- Never connect to production MongoDB, Sheets or Tally exports.
- Never commit `.env*`, service-account JSON, PINs, or customer/receivable data.
- Freeze windows: month-end close (last working day → 5th) and Tally upload
  days (Wednesday, Saturday) — no releases.

## Class 3 paths — human-led, process-owner sign-off required
- Money & receivables: `backend/src/services/receivables*.js`, `bulkReceivables.*`,
  `billing*.js`, `pendingBilling.*`, `transport.*`
- Disputes & approvals: `disputes.*`, `approveCategory.service.js`, `approvalSummary.*`
- Sheet writers: `backend/src/services/sheetPushers/`, `writeThrough.service.js`,
  `googleSheets.service.js`, `backend/src/config/mongoSheetMapping.js`,
  `backend/src/utils/sheetMutex.js`
- Auth & permissions: `auth.*`, `roles.service.js`, `permission*`,
  `backend/src/config/permissions.config.js`

## Conventions
- Small PRs, one ticket each; title starts with the ticket key, e.g. `COL-17: …`.
- Amounts: Dr = owed to Crystal; ±0.5 tolerance is the reconciliation auto-confirm rule.
