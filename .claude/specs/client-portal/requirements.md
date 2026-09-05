# Requirements — Client Portal

> DRAFT — awaiting approval before design.md. Depends on `identity-and-rbac`
> (the `USER` principal type) and `core-invoicing` (the invoice data it
> displays).

## Surfaces touched
Backend, Website (`apps/web`, unauthenticated-to-portal flow). Not the
tenant dashboard, not mobile (client portal is web-only per `product.md`).

## User stories

### 1. Passwordless access
- WHEN a client receives an invoice email THEN it SHALL include both (a) a
  direct secure payment link for that one invoice, and (b) a "View all
  invoices" link into the client portal — both SHALL be supported, not
  one instead of the other.
- WHEN a client requests portal access (via the invoice email link, or by
  entering their email on a portal login page) THEN the system SHALL send
  a magic link to that email — no password is ever created or required
  for a `USER` principal.
- WHEN a client clicks a valid, unexpired magic link THEN the system SHALL
  authenticate them as the `client_users` record linked to their `clients`
  row, scoped to that one workspace's client relationship.
- IF the same email address is a client of multiple workspaces THEN the
  system SHALL let them see invoices from each, but SHALL keep each
  workspace's invoices clearly separated in the portal (never merged into
  one undifferentiated list) — decide exact UX before design.md.

### 2. Portal content
- WHEN a client is authenticated in the portal THEN the system SHALL show:
  outstanding invoices, overdue invoices, paid invoices, payment history,
  and downloadable receipts — scoped strictly to `invoices.client_id`
  matching their own `client_users` link.
- WHEN a client views an invoice THEN the system SHALL show its line
  items, currency, due date, and current status, and (if unpaid) a
  "Pay Now" action.
- WHEN a client updates their own contact information THEN the system
  SHALL persist it to their `clients` record — this SHALL NOT be
  authorized by workspace role (it's the client's own record), only by
  `client_users` ownership.

### 3. Payment from the portal
- WHEN a client pays from the portal THEN the same webhook-verified
  payment flow from `core-invoicing` applies — the portal is another
  entry point to the same payment-link flow, not a separate payment path.

### 4. Isolation
- WHEN a client requests any invoice, receipt, or payment record THEN the
  system SHALL reject access to anything where `invoice.client_id` doesn't
  match the authenticated `client_users` link — this check happens on
  every request, never inferred from a previously-authorized session
  alone.

## Explicit exclusions from this spec
- Client portal on mobile — web-only (see `product.md`).
- Any workspace-side (ADMIN/MEMBER) functionality — that's
  `core-invoicing` and `identity-and-rbac`.

## Acceptance criteria for spec approval
- [x] Multi-workspace client UX decided — email-scoped magic link +
      business switcher, see `design.md`
- [x] Magic-link expiry (15 min) and rate limit (5/email/hour) chosen
- [x] Receipts confirmed generated at payment-confirmation time, stored
      (not rendered fresh per download)

Spec approved for design — proceeding to `tasks.md`.
