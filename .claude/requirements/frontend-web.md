# Frontend — Tenant Web App (`apps/web`) — Functional & Non-Functional Requirements

Covers the marketing site, the authenticated ADMIN/MEMBER dashboard, and the client portal (`USER`) — all one Next.js app. Cross-reference: `steering/tech.md`, `rules/frontend-web.md`, `steering/architecture-principles.md`, and the four specs.

## Functional requirements

### Marketing
Public pages (home, pricing, features) — SSR/SSG, no auth.

### Auth
Registration, login (email/password), logout, email verification, forgot/reset password, access-token refresh, session-expiry handling, logout-this-device (logout-all-devices later). The frontend talks **only** to the backend auth API — never directly to the database:
```
Next.js → Node.js Auth API → Neon PostgreSQL
```

### Role-adapted UI
- **ADMIN**: workspace dashboard, clients, invoices, payments, reports, members, workspace settings, reminder settings, subscription management.
- **MEMBER**: dashboard, clients, invoices, payments, limited reports. Cannot manage workspace ownership, subscriptions, Admin roles, or delete the workspace.
- **USER** (client portal): my invoices, outstanding, overdue, payments, receipts, profile — nothing else.

### Workspace management (ADMIN)
Create workspace; update business name; billing address; tax/GST details; company logo; invoice prefix; default currency; payment settings; reminder rules. A user may belong to multiple workspaces with a different role in each — the frontend supports workspace switching.

### Team management (ADMIN)
Invite member, view team, resend invitation, revoke invitation, change role, disable/remove member. Invitation statuses shown: `PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED`.

### Client management (ADMIN/MEMBER)
Create, view, edit, archive (prefer over hard delete once invoice history exists), search, filter; view a client's invoices and payment history.

### Invoice management
Create, save draft, edit draft, duplicate, line items, tax, discount, notes, terms, due date, currency, preview, send, resend, download PDF, cancel (only from `DRAFT`/`SENT`), record offline payment.

Statuses shown clearly: `DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`. The frontend displays status — the **backend** is the sole authority for transitions (see domain skill's state machine); no UI control ever sets a status directly.

Invoice numbers are backend-generated (e.g. `INV-2026-0001`); ADMIN configures prefix, starting sequence, and financial-year format, but never types a number directly.

### PDF & email
Preview/download/email PDF, share invoice link. Send/resend invoice email with preview, delivery-state, and failure-state visibility.

### Payments
Tenant view: payment status, date, amount, transaction reference; record offline payment; download receipt. Client-portal (`USER`) view: open invoice → Pay Now → complete Razorpay payment → confirmation → download receipt.

### Live updates
```
Razorpay → Webhook → Node.js → PostgreSQL → Redis invalidation → SSE → Frontend
```
Invoice status updates without a full page reload wherever SSE is active.

### Reminders (ADMIN)
Enable/disable, configure schedule (e.g. 3 days before due, on due date, +3d overdue, +7d overdue), preview content, view send history.

### Dashboard
Outstanding, paid, overdue, due-soon totals; client/invoice counts; recent invoices/payments — **grouped by currency, never summed across currencies** (₹75,000 outstanding and $2,000 outstanding are two lines, not one number).

### Reports
Invoice ageing, monthly revenue, outstanding/overdue invoices, payments received, client-wise revenue, status distribution. CSV/PDF export is a later addition, not required for the initial build.

### Subscription management (ADMIN, owner-gated per identity-and-rbac)
View plan, usage, upgrade/downgrade, cancel, renewal date, billing history.

### Client portal (USER)
Login (magic link), own invoices, outstanding/overdue, download invoice, pay, payment history, receipts, basic profile update. Strictly scoped — a `USER` never sees another client's data.

## Non-functional requirements

| Category | Requirement |
|---|---|
| Performance | Initial page load ideally < 3s; navigation feels responsive; paginate invoice/client lists; lazy-load large components; avoid redundant API calls; cache non-sensitive data appropriately. Marketing pages: LCP < 2.5s on 4G. |
| Responsive | Desktop, tablet, mobile browser. |
| Accessibility | WCAG 2.1 AA where practical on dashboard and client portal — keyboard nav, form labels, focus indicators, screen-reader-friendly messages, sufficient contrast. |
| Security | Never expose DB credentials or JWT signing secrets to the client; never trust a UI role check alone (backend re-verifies every time); avoid sensitive data in logs; sanitize user-generated output; HTTPS only; secure access/refresh token handling (httpOnly cookies or secure storage, never plain `localStorage`). |
| Reliability | Handle gracefully: API timeout, network loss, expired session, duplicate submission, payment pending/failed, PDF generation failure, email failure — each with a clear, non-broken UI state (`architecture-principles.md` #3, graceful degradation). |
| Maintainability | TypeScript; reusable components; shared validation (same zod schema as the API, from `packages/types`); feature-based modules; a central API layer. |
| Browser support | Last 2 major versions of Chrome, Safari, Firefox, Edge. |
| State discipline | Server-owned data via TanStack Query, not duplicated into Zustand; shareable filters live in the URL. |

## Explicit exclusions
Admin console functionality (separate app, separate doc) — never merged into this app or its session.
