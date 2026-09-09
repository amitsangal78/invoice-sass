# Subscription Billing (tenant → platform)

## Purpose

What a workspace pays Billify (Free/Starter/Pro), as distinct from what a workspace's *clients* pay the workspace — [core-invoicing.md](core-invoicing.md)'s payments. These two money flows are kept structurally separate on purpose (see below), never conflated.

## The file-boundary rule

`routes/billing.ts`/`routes/subscription-webhooks.ts` vs. `routes/webhooks.ts` is the *enforcement mechanism* for "never touch `payments`/`invoices` from the subscription path" — a reviewer sees instantly which file they're in, rather than needing to trace conditional logic inside one shared handler. The subscription webhook handler **only ever writes to `subscriptions`**.

## Plan limits — one source of truth

`apps/api/src/config/plan-limits.ts`'s `PLAN_LIMITS` (FREE/STARTER/PRO × maxClients/maxInvoicesPerMonth/autoReminders/recurringInvoices/customBranding/maxTeamMembers) is read **only** through `checkPlanLimit()` (`services/subscriptions/check-plan-limit.ts`) — never read directly by a gated action. That function Redis-caches the subscription lookup (`workspace:{id}:plan`, same TTL band as the permissions cache) and throws `PlanLimitExceededError` on violation, caught by the route error middleware into `{ error: { code: 'plan_limit_exceeded', ... } }`.

Gated actions that call it: `core-invoicing`'s `createInvoice`/`createClient`, the `send-reminders` job, `identity-and-rbac`'s team-invite flow.

## Status model

`ACTIVE | PAST_DUE | CANCELLED` — `PAST_DUE` is its own status, not a boolean flag, so "are we mid-grace-period" is a direct query. First payment failure → `PAST_DUE`, **plan limits unchanged** (no immediate restriction). Only the provider's final "subscription ended" webhook (after its own dunning cycle) → `CANCELLED`, plan reverts to `FREE`. Data is never deleted on downgrade — a workspace that drops to Free with 10 clients can view all 10 but can't add an 11th.

## Bootstrapping

A `subscriptions` row (`plan: FREE`, `status: ACTIVE`) is created at the same time as the `workspaces` row — a second responsibility bolted onto `identity-and-rbac`'s `signup()` (see that domain's wiki page), not duplicated here.

## Key files

- Schema: `packages/db/src/schema/subscriptions.ts` — `subscriptions`, `subscriptionWebhookEvents` (its own dedupe ledger, independent of `core-invoicing`'s `webhookEvents` — different event universe entirely).
- Config: `apps/api/src/config/plan-limits.ts`.
- Services: `apps/api/src/services/subscriptions/{check-plan-limit,subscription-billing}.ts`.
- Routes: `apps/api/src/routes/{billing,subscription-webhooks}.ts`.

## Mobile surface

`GET /billing/plan` is the **entire** mobile-facing surface for this domain — no checkout, no cancel, no card entry (deliberate IAP exclusion, `product.md`).

## Invariants

- Every billing action (`checkout`, `cancel`) requires `requireOwner`, not `requireRole('ADMIN')` — a non-owner ADMIN is rejected.
- Pricing identifiers come from env vars (`RAZORPAY_PLAN_STARTER_ID`, etc.), never literal amounts in code — finalizing real pricing is a deploy-time config change, not a code change.

## Known gaps

Checkout-session creation and cancellation aren't wired to live Razorpay/Stripe credentials — webhook *handling* is fully implemented and tested against synthetic signed payloads.
