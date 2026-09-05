# Product — Invoice + Payment Reminder SaaS

## Promise

"Create invoices, track payments, and stop manually chasing clients."

A lightweight invoicing + reminder tool for freelancers, consultants, and small agencies. Not a Zoho Books / QuickBooks competitor — deliberately narrow on accounting depth, but full-featured on the invoicing/payments/team/admin surface. There is no phased rollout — every surface and capability below is in scope for the build now.

## The core jobs

1. Invoice creation — clients, line items, multi-currency totals, PDF, branded email.
2. Payment tracking — payment links + webhooks (Razorpay first, Stripe international), plus manual mark-as-paid for offline payments.
3. Automatic reminders — the actual retention hook. Protect this over adding breadth elsewhere.
4. Client management — a contact list with invoice history, not a CRM.
5. Team & workspace management — invite members, assign roles, manage the workspace.
6. Client self-service — a portal where the tenant's clients see and pay their own invoices.
7. Platform operations — internal tooling to run the SaaS itself (tenant support, plan management, system health).

## Explicit non-goals (still true regardless of build order)

- No general ledger / chart of accounts / tax filing.
- No currency conversion engine — multi-currency is supported per-invoice (see below), but nothing converts or nets currencies together.
- No inventory or expense tracking.
- No competing on accounting depth — competing on "stops the manual chasing," full stop.
- No Business tier functionality yet (see Plan gating) — the architecture stays capable of it, but it isn't built.

When a request drifts toward one of the non-goals, flag the scope question before building.

## Roles

Two different kinds of principal, modeled differently — see `architecture-principles.md` and the `invoice-reminder-saas-domain` skill for the schema:

**Platform roles** (internal SaaS team, not tied to any one workspace):
- `SUPER_ADMIN` — full platform access: tenants, plans, platform config, metrics, suspend/reactivate. Does not casually modify a tenant's financial data (invoices, payments) — that stays support-only, audited.
- `SUPPORT_ADMIN` — restricted operations: search tenants, view status/metadata, view failed webhook events, resend verification, unlock accounts. Cannot touch pricing, delete a tenant, or modify financial records.

**Workspace roles** (scoped per-workspace via membership — a user can hold different roles in different workspaces):
- `ADMIN` — the workspace owner (or a promoted co-admin). Full control: clients, invoices, team, subscription/billing, branding, integrations, reports. `workspace.ownerId` marks the one member who can delete the workspace, transfer ownership, or cancel the subscription — being `ADMIN` alone doesn't grant those three.
- `MEMBER` — day-to-day operator (accountant, sales exec). Can create/edit/send invoices, manage clients, mark paid, view reports. Cannot manage team/roles, billing, workspace settings, or delete anything.

**Client portal role** (not a workspace member at all):
- `USER` — the tenant's client/payer. Scoped to their own invoices only, never to the workspace dashboard. Authenticates passwordlessly (magic link) — unlike `ADMIN`/`MEMBER`, who log in with a password against the self-built auth service (see `tech.md`).

## Surfaces

| Surface | Who it's for | Notes |
|---|---|---|
| Tenant web app (`apps/web`) | The freelancer/agency — this **is** the product | Next.js; marketing pages + authenticated dashboard (ADMIN/MEMBER) + client portal (USER) |
| Internal admin console (`apps/admin`) | SUPER_ADMIN / SUPPORT_ADMIN | React + Vite; cross-tenant, RBAC-gated, never merged with the tenant app |
| Mobile app (`apps/mobile`) | The freelancer/team, on the go | React Native; operational subset, not full parity — see below |
| Backend (`apps/api`) | Serves all three | Single API, workspace-scoped authorization on every route |

### Mobile scope (deliberately a subset, not a phase)

Mobile covers daily operations: dashboard, clients, invoice list/detail, create a simple invoice, send/share an invoice, mark payment received, view payments, push notifications (payment/overdue), customer search, basic reports.

Mobile does **not** cover: complex invoice editing, workspace settings, team management, subscription management, branding, integrations, exports, advanced reporting, or any Super Admin functionality. Subscription management is web-only — no Apple/Google in-app purchase; the app shows current plan + a "Manage on web" link, avoiding StoreKit/Play Billing entirely (see `tech.md` for why).

## Plan gating (Free / Starter / Pro)

| Feature | Free (₹0/mo) | Starter (₹299/mo, ~₹2,999/yr) | Pro (₹699/mo, ~₹6,999/yr) |
|---|---|---|---|
| Clients | 3 | 25 | Unlimited |
| Invoices/month | 5 | 50 | Unlimited |
| Automatic reminders | – | ✓ | ✓ |
| Payment links | – | ✓ | ✓ |
| Client portal | – | ✓ | ✓ |
| Custom logo/branding | – | ✓ | ✓ |
| Basic reports | – | ✓ | ✓ |
| Recurring invoices | – | – | ✓ |
| Multiple team members | – | – | ✓ |
| Advanced reports/exports | – | – | ✓ |
| Priority support | – | – | ✓ |

Numbers above are a working draft, not locked pricing — confirm before they appear anywhere customer-facing. Business tier (agencies, multi-workspace, approval workflows, API access) is deliberately not built — see non-goals — but plan-gating logic should be written so adding a fourth tier later doesn't require restructuring the gating engine.

Two separate money flows, never conflated: **tenant subscription** (the tenant pays the platform, via Razorpay/Stripe subscription billing) vs. **invoice payment** (the tenant's client pays the tenant, via Razorpay/Stripe payment links). See the domain skill for how this is modeled in the schema.
