# Requirements — Core Invoicing

> DRAFT — awaiting approval before design.md. Depends on `identity-and-rbac`
> (workspace membership + roles must exist before invoice actions can be
> authorized) — read that spec alongside this one.

## Surfaces touched
Backend, Website (`apps/web` tenant dashboard), Mobile (subset — see
`product.md`). Not the admin console or the client portal — those are
covered by `identity-and-rbac` and `client-portal` respectively.

## User stories

### 1. Client management
- WHEN an ADMIN or MEMBER adds a client with name, email, and optional
  billing address THEN the system SHALL persist the client scoped to the
  caller's `workspace_id`.
- WHEN a workspace member views the client list THEN the system SHALL
  return only clients belonging to that workspace.
- WHEN a MEMBER attempts to delete a client THEN the system SHALL reject
  it — delete is ADMIN-only (see RBAC table in the domain skill).
- WHEN an ADMIN deletes a client THEN the system SHALL prevent deletion if
  the client has any non-draft invoices, or SHALL require an explicit
  confirmation acknowledging historical invoices remain (decide which
  before design.md).

### 2. Invoice creation
- WHEN a workspace member creates an invoice for a client THEN the system
  SHALL require at least one line item (description, quantity, unit
  price) and a `currency`.
- WHEN an invoice is created THEN the system SHALL compute subtotal, tax
  (if applicable), and total automatically, and SHALL store the computed
  values (not derive them on read).
- WHEN a member saves an invoice without sending it THEN the system SHALL
  store it with status `draft`, and only ADMIN/MEMBER of that workspace
  may edit or delete it while in `draft`.
- WHEN a workspace is on the Free plan and has reached its invoice/client
  limit THEN the system SHALL reject creation with a plan-limit error,
  enforced server-side (see plan gating in the domain skill).

### 3. Sending an invoice
- WHEN a member sends an invoice THEN the system SHALL email the client a
  PDF copy and a payment link (or, once `client-portal` exists, a portal
  link), and SHALL set status to `sent` with a `sent_at` timestamp.
- WHEN an invoice is sent THEN the system SHALL write an
  `INVOICE_SENT` row to `invoice_events`.

### 4. Payment tracking
- WHEN a client pays via a payment link THEN only a verified
  Razorpay/Stripe webhook SHALL mark the invoice `paid` — a browser
  redirect alone SHALL NOT change status (see domain skill's webhook
  rule).
- WHEN an ADMIN or MEMBER manually marks an invoice paid (offline
  payment) THEN the system SHALL record it distinctly from a webhook
  confirmation (e.g. a `source: manual` field on the `payments` row) so
  reporting can distinguish the two.
- WHEN the current date passes an invoice's due date and it is unpaid
  THEN a scheduled job — never a UI action — SHALL mark it `OVERDUE`.
- WHEN cumulative recorded payments on an invoice are more than zero but
  less than its total THEN the system SHALL set status `PARTIALLY_PAID`;
  WHEN cumulative payments meet or exceed the total THEN `PAID`.
- WHEN an ADMIN cancels an invoice THEN the system SHALL only permit this
  from `DRAFT` or `SENT` — cancelling a `PARTIALLY_PAID` or `PAID` invoice
  SHALL be rejected (a refund/credit-note flow is a separate, unbuilt
  feature).
- WHEN any status-changing action occurs THEN the system SHALL write the
  corresponding `invoice_events` row.

### 5. Dashboard summary
- WHEN a workspace member opens their dashboard THEN the system SHALL
  show total outstanding (sent + overdue) and total paid, scoped to that
  workspace, **grouped by currency** — never summed across currencies.
- WHEN an invoice's status changes (e.g. paid via webhook) THEN the
  system SHALL push the update to any open dashboard for that workspace
  via SSE, without requiring a manual refresh.

### 6. Reminders
- WHEN an invoice becomes `overdue` THEN the system SHALL trigger the
  reminder cascade defined in the domain skill (before-due nudge already
  sent; then overdue+3d, overdue+10d), logging each send in `reminder_events`
  so the same reminder is never sent twice.
- WHEN a workspace is on the Free plan THEN automatic reminders SHALL be
  disabled (plan-gated feature).

## Explicit exclusions from this spec
- Recurring invoices — Pro-only, own future spec.
- Custom branding/templates — covered by workspace settings, not this
  spec.
- Client-facing portal behavior — see `client-portal`.
- Team/role management, workspace creation — see `identity-and-rbac`.
- Tenant subscription billing — see `subscription-billing`.

## Acceptance criteria for spec approval
- [x] Client-delete behavior decided — always archive (soft-delete), never
      a true delete; see `design.md`
- [x] Confirmed this spec depends on, rather than duplicates,
      `identity-and-rbac`'s authorization model
- [x] Currency handling confirmed sufficient as specified

Spec approved for design — proceeding to `tasks.md`.
