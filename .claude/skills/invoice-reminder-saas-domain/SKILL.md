---
name: invoice-reminder-saas-domain
description: Use whenever implementing or discussing a feature for Amit's Invoice + Payment Reminder SaaS specifically — clients, invoices, invoice status/lifecycle, PDF/email invoicing, marking paid, payment webhooks (Razorpay/Stripe), subscription billing, RBAC/workspace roles, the client portal, automatic reminders, or Free/Starter/Pro plan limits. Always consult this before adding an invoice field, changing invoice status logic, touching roles/permissions, or wiring a payment/webhook flow — it encodes the product's scope guardrails, data model, and state-machine rules so features don't drift into full-accounting-software territory or bypass idempotency/RBAC/plan-gating rules.
---

# Invoice + Payment Reminder SaaS — domain rules

Product promise: *"Create invoices, track payments, and stop manually chasing clients."* The product is deliberately narrow on accounting depth — invoice creation, payment tracking, automatic reminders, client management, team/workspace management, a client portal, and platform operations tooling. It is not a Zoho Books / QuickBooks competitor. Everything in this doc is built now — there is no phased rollout.

**Scope guardrail:** when a feature request drifts toward general accounting (expense tracking, chart of accounts, tax filing, currency conversion/FX, inventory), flag that it's outside this product's promise before building it. The reminder engine is the actual retention hook — protect it over adding breadth elsewhere.

## Roles and how they're modeled (don't collapse this into one roles table)

Two different kinds of principal — see `tech.md` for the full rationale:

- **Platform roles** — `users.platform_role` is `SUPER_ADMIN`, `SUPPORT_ADMIN`, or `NORMAL_USER` (the default for every tenant user). Only `SUPER_ADMIN`/`SUPPORT_ADMIN` values grant admin-console access; `NORMAL_USER` is not tied to any workspace and carries no special permission.
- **Workspace roles** — `ADMIN`, `MEMBER` — live on `workspace_members.role`, keyed by `(user_id, workspace_id)`. A user can be `ADMIN` in one workspace and `MEMBER` in another — never store a workspace role directly on `users`.
- **Ownership** — `workspaces.owner_id` marks the one member who can delete the workspace, transfer ownership, or cancel the subscription. Being `ADMIN` is necessary but not sufficient for those three actions.
- **Client portal principal** — `USER` — not a workspace member at all. A `clients` row optionally links to a `client_users` login (passwordless/magic-link), scoped to that one client's own invoices within one workspace. Never authorize a `USER` by role alone — always also check `invoice.client_id === session.client_id`.

`SUPER_ADMIN` and `SUPPORT_ADMIN` view tenant financial data (invoices, payments) as **support-only** — read access for troubleshooting, not routine editing. Direct modification of a tenant's invoice/payment data by platform staff is exceptional and must be audited (see `invoice_events` below), never a normal workflow.

## Data model (don't restructure later — only add to it)

- `users` — one row per human. `platform_role` (`SUPER_ADMIN`/`SUPPORT_ADMIN`/`NORMAL_USER`, default `NORMAL_USER`). Password hash (Argon2/bcrypt) lives here for `ADMIN`/`MEMBER`/platform-staff logins — `USER` (client portal) never has a password, see `client_users`.
- `refresh_tokens` — hashed refresh tokens, one row per active session/device, so a single device can be revoked (logout-this-device) without touching the others, and all can be revoked at once (logout-all-devices, password reset).
- `email_verification_tokens`, `password_reset_tokens` — hashed, single-use, expiring tokens. Mark used, don't just rely on expiry.
- `workspaces` — one row per tenant business. `owner_id` references the owning member. Also carries business profile fields: display name, billing address, tax/GST number, logo (S3 reference), invoice-numbering config (prefix, starting sequence, financial-year format), default currency, reminder-schedule config.
- `workspace_members` — `(user_id, workspace_id, role)`, role is `ADMIN` or `MEMBER`. This *is* the multi-tenancy model — every tenant-owned query resolves through this table, not a bare `user_id`.
- `workspace_invitations` — a pending invite: email, workspace, proposed role, status (`PENDING`/`ACCEPTED`/`EXPIRED`/`REVOKED`). Accepting one creates or links a `users` row and activates the matching `workspace_members` row — see `identity-and-rbac` spec for the exact linking rule.
- `clients` — a workspace's payer contacts, scoped by `workspace_id`. Prefer archive (soft-delete) over hard delete once a client has any non-draft invoice history.
- `client_users` — optional passwordless login for a `clients` row, enabling client-portal (`USER`) access to that client's own invoices only.
- `invoices` — `workspace_id`, `client_id`, `invoice_number` (per-workspace sequence, e.g. `INV-2026-0007`, generated via `invoice_sequences` under a transaction/lock so concurrent creation can't collide), `status`, `due_date`, `currency`, computed totals **stored** (subtotal/tax/discount/total), not derived on read — historical invoices must not drift if pricing logic changes later. All monetary columns `NUMERIC`/`DECIMAL`, never `float`.
- `invoice_sequences` — per-workspace counters backing invoice numbering, incremented atomically.
- `invoice_items` — `amount` stored per line, same reasoning as above.
- `payments` — invoice payment attempts (one invoice can have multiple/partial payments — see `PARTIALLY_PAID` below) — this is the tenant's **client** paying the **tenant**. Never collapse this into a status flag on `invoices`.
- `subscriptions` — the **tenant** paying the **platform** for SaaS access (Free/Starter/Pro). Structurally and semantically distinct from `payments` — don't conflate the two when naming fields, writing queries, or handling webhooks. A payment-provider webhook for a subscription event and one for an invoice-payment event go through the same idempotency mechanism but touch entirely different tables.
- `webhook_events` — the idempotency ledger for *both* payment flows above. Unique on `provider_event_id`. Insert-or-ignore before processing any webhook payload — providers *will* redeliver events. (Redis holds a short-lived idempotency key for the fast path — see `tech.md`'s Redis conventions — but this table is the durable record.)
- `reminder_rules` — a workspace's configured schedule (e.g. before-due, +3d overdue, +10d overdue), editable by ADMIN.
- `reminder_events` — a log of what was actually sent, against which rule, for which invoice — never re-derive "was this sent" from `reminder_rules` alone.
- `invoice_events` — the audit trail. `(workspace_id, invoice_id, user_id, event, old_value, new_value, ip_address, created_at)`. Every financial-state-changing action writes a row here: `INVOICE_CREATED`, `INVOICE_UPDATED`, `INVOICE_SENT`, `INVOICE_MARKED_PAID`, `PAYMENT_RECEIVED`, `PAYMENT_FAILED`, `INVOICE_CANCELLED`, `REMINDER_SENT`, plus auth/team events (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `MEMBER_INVITED`, `ROLE_CHANGED`, `WORKSPACE_UPDATED`). This also backs `SUPPORT_ADMIN`'s read-only tenant visibility — support answers questions from the audit trail, not by querying live financial tables directly.

## Invoice state machine

`DRAFT → SENT → PAID` or `SENT → PARTIALLY_PAID → PAID`, or `SENT → OVERDUE → (still can become PARTIALLY_PAID/PAID at any time)`, plus `CANCELLED` reachable from `DRAFT` or `SENT`.

- `DRAFT → SENT`: user action (ADMIN or MEMBER) — invoice is emailed + PDF generated.
- `SENT → OVERDUE`: **not a user action** — a scheduled job flips it when `due_date < now()`. Never let a UI control set `OVERDUE` directly.
- `→ PARTIALLY_PAID`: a payment is recorded (webhook or manual) whose total-to-date is less than the invoice total. Never derive this by comparing floats — compare the stored `NUMERIC` sum of `payments` against the invoice total.
- `→ PAID`: either a manual "mark as paid" action (ADMIN/MEMBER, for offline payments, tagged `source: manual`) or a verified webhook — see below. Both are valid; only the webhook counts as proof for an online payment. Reached when cumulative payments meet or exceed the invoice total.
- `→ CANCELLED`: user action (ADMIN), only from `DRAFT` or `SENT` — never cancel a `PAID`/`PARTIALLY_PAID` invoice; that's a refund/credit-note concern, out of scope until explicitly designed.
- `OVERDUE` triggers the reminder cascade per the workspace's `reminder_rules` (before-due nudge already sent; then overdue+3d, overdue+10d by default), logged individually in `reminder_events` so the same reminder is never sent twice.

## Payments & webhooks

- Two independent signals exist after a client pays: the browser redirect back to your site, and the provider's server-to-server webhook. **Only the webhook may mark an invoice paid.** The redirect is a UX nicety only — it can be closed, lost, or blocked, and must never be trusted as proof of payment.
- Every webhook handler: verify the provider's signature → check `webhook_events` for the `provider_event_id` (skip if already processed) → then update `payments` and `invoices.status` (invoice-payment webhook) or `subscriptions` (subscription-billing webhook) — never both from the same event. In that order, every time.
- Keep providers behind a small interface (`createPaymentLink()`, `verifyWebhook()`) rather than branching provider-specific code through the invoice logic — Razorpay for India, Stripe internationally, same call sites, for both invoice payments and subscription billing.

## RBAC permission reference

| Action | SUPER_ADMIN | SUPPORT_ADMIN | ADMIN | MEMBER | USER (client) |
|---|---|---|---|---|---|
| Platform dashboard, tenant list, plan management | ✓ | view-only | – | – | – |
| Suspend/reactivate workspace | ✓ | – | – | – | – |
| View workspace financial data | support-only | support-only | ✓ | ✓ | own invoices only |
| Create/edit client | – | – | ✓ | ✓ | – |
| Delete client | – | – | ✓ | – | – |
| Create/edit draft invoice | – | – | ✓ | ✓ | – |
| Delete draft invoice | – | – | ✓ | – | – |
| Send / resend invoice | – | – | ✓ | ✓ | – |
| Mark paid (offline) | – | – | ✓ | ✓ | – |
| Mark unpaid | – | – | ✓ | – | – |
| View own invoice, pay, download receipt | – | – | – | – | ✓ |
| Invite/remove team member, change roles | – | – | ✓ | – | – |
| Workspace settings, branding, integrations | – | – | ✓ | – | – |
| Manage subscription, billing details | – | – | ✓ | – | – |
| Delete workspace, transfer ownership | – | – | owner only | – | – |

Never authorize by `role === 'X'` alone for anything workspace- or client-scoped — always also check the resource belongs to the caller's `workspace_id` (or, for `USER`, `client_id`). See `rules/backend-api.md`.

## Plan gating (Free / Starter / Pro)

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Clients | 3 | 25 | Unlimited |
| Invoices/month | 5 | 50 | Unlimited |
| Automatic reminders | – | ✓ | ✓ |
| Payment links | – | ✓ | ✓ |
| Client portal | – | ✓ | ✓ |
| Custom logo/branding | – | ✓ | ✓ |
| Recurring invoices | – | – | ✓ |
| Multiple team members | – | – | ✓ |
| Reports & export | – | – | ✓ |

Enforce every limit **server-side**, in one shared limits config the API reads before creating a client/invoice or enabling a feature — never rely on hiding a button in the UI as the actual gate. Pricing above is a working draft (see `product.md`) — confirm before it's customer-facing, but the gating *logic* is built now, not deferred.

## When building a new feature in this domain

1. Check whether it fits the product's core jobs (see `product.md`) — if not, flag the scope question rather than building silently.
2. If it touches invoice status, route the change through the state machine above — no ad hoc status writes.
3. If it touches money changing hands, it goes through the webhook idempotency pattern above, full stop — and through the correct table (`payments` vs. `subscriptions`), never conflated.
4. If it touches access control, resolve through `workspace_members`/`platform_role`/`client_users` as documented above — never a bare role check without a resource-ownership check.
5. If it changes financial state, it writes an `invoice_events` row.
