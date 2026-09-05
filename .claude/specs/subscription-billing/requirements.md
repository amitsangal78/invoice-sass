# Requirements — Subscription Billing (Tenant → Platform)

> DRAFT — awaiting approval before design.md. Depends on
> `identity-and-rbac` (only the workspace owner may act on billing).
> **Do not confuse this spec with invoice payments in `core-invoicing`** —
> this is the tenant paying the platform, a structurally separate flow
> (separate tables, separate webhooks) per the domain skill.

## Surfaces touched
Backend, Website (billing settings — owner-only). Mobile shows plan status
read-only with a "Manage on web" link; no in-app purchase (see
`product.md` for why IAP is explicitly excluded).

## User stories

### 1. Plan selection & signup default
- WHEN a workspace is created THEN the system SHALL default it to the
  Free plan with no payment method required.
- WHEN the owner selects a paid plan (Starter/Pro) THEN the system SHALL
  initiate a Razorpay/Stripe subscription checkout — never a one-off
  payment-link flow (that's `core-invoicing`'s mechanism, not this one).

### 2. Plan enforcement
- WHEN any action is gated by plan (client count, invoice count,
  automatic reminders, recurring invoices, multiple team members, custom
  branding) THEN the system SHALL check the workspace's current plan
  server-side, from one shared limits config, before allowing the action
  — never relying on a hidden UI button as the actual gate (see the plan
  gating table in the domain skill).
- WHEN a workspace exceeds a Free-plan limit (e.g. 4th client) THEN the
  system SHALL reject the action with a clear upgrade prompt, not a
  generic error.

### 3. Billing lifecycle
- WHEN a subscription billing webhook arrives (payment succeeded, payment
  failed, subscription cancelled, plan changed) THEN the system SHALL
  verify its signature, dedupe via `webhook_events`, and update the
  `subscriptions` table only — never touch `payments` or `invoices` from
  this webhook path.
- WHEN a subscription payment fails THEN the system SHALL follow the
  provider's dunning/retry behavior and SHALL downgrade or restrict the
  workspace only after the provider's grace period, not immediately on
  first failure.
- WHEN the owner cancels the subscription THEN the system SHALL keep the
  current plan active until the end of the paid period, then downgrade to
  Free — data is retained, not deleted, on downgrade.

### 4. Mobile
- WHEN a mobile user views their plan THEN the system SHALL show current
  plan, renewal date, and a "Manage on web" action — the app SHALL NOT
  implement StoreKit or Google Play Billing, and SHALL NOT accept card
  details for subscription purchase in-app.

## Explicit exclusions from this spec
- The Business tier — not built yet, see non-goals in `product.md`.
- FX/currency conversion for subscription pricing across regions — single
  base currency for subscription pricing initially (confirm which).

## Acceptance criteria for spec approval
- [x] Pricing confirmed as config-driven (env-configured provider plan/price
      ids) — code never hardcodes amounts, so `product.md`'s numbers stay a
      pricing-page concern, not a code dependency; see `design.md`
- [x] Downgrade behavior decided — `PAST_DUE` status on first failure (plan
      unchanged), `CANCELLED` + revert to `FREE` only after the provider's
      own dunning cycle ends; data retained always
- [x] Confirmed owner-only (`requireOwner`, not `requireRole('ADMIN')`)

Spec approved for design — proceeding to `tasks.md`.
