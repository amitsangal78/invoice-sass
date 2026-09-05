# Tasks — Subscription Billing

Depends on `identity-and-rbac` (`requireOwner`, `signup()`).

**Status: implemented and passing (97/97 tests overall, TypeScript strict, ESLint clean).**

## 1. Schema & migration
- [x] `subscriptions`, `subscriptionWebhookEvents` (part of the initial migration, since all four specs' schemas were written together up front).
- [x] `signup()` seeds a `FREE`/`ACTIVE` row per workspace — implemented in `identity-and-rbac`'s pass, noted there rather than duplicated.

## 2. Plan limits (`config/plan-limits.ts`, `services/subscriptions/check-plan-limit.ts`)
- [x] `PLAN_LIMITS` config and `checkPlanLimit()` — **implemented during `core-invoicing`'s pass**, not this one, because `core-invoicing`'s own requirements mandate real enforcement (never a stub that silently skips the check). `createInvoice()`/`createClient()`/the reminder job all call it for real.
- [x] Every limit tested: client cap, monthly invoice cap, `enable_reminders` (via the Free-plan-skip test in `jobs/send-reminders.test.ts`).

## 3. Checkout & cancel routes (`routes/billing.ts`)
- [x] `POST /billing/checkout` — `requireOwner`, tested for owner-only enforcement at the HTTP layer.
- [x] `POST /billing/cancel` — sets `cancelAtPeriodEnd` only, no immediate downgrade (tested).
- [x] `GET /billing/plan` — any workspace member, tested.
- **Deviation**: `initiateCheckout()` throws a documented `501 not_implemented` rather than returning a fake checkout URL — this environment has no live Razorpay/Stripe credentials to call out to (same boundary pattern as `core-invoicing`'s `createRazorpayOrder`/`createStripeCheckoutSession`). The RBAC layer in front of it is fully real and tested; only the actual provider call is stubbed.

## 4. Subscription webhooks (`routes/subscription-webhooks.ts`, `services/subscriptions/subscription-billing.ts`)
- [x] Razorpay + Stripe handlers, own dedupe ledger (`subscriptionWebhookEvents`), kept in a **separate router file** from `core-invoicing`'s payment webhooks — the file boundary is the enforcement mechanism for "never touch payments/invoices from this path," verified by a test that confirms `payments` is untouched by a subscription webhook call.
- [x] `PAST_DUE` on first failure (plan unchanged) → `CANCELLED` + `FREE` only on `subscription_ended`, tested end-to-end including a "data retained, nothing deleted" check (5 pre-existing invoices survive a downgrade below the Free plan's limit).
- [x] Dedupe tested at both the service layer and the HTTP layer (redelivered event → 200, no duplicate processing).
- **Note**: the raw-payload event-name mapping (`mapEventType()` in the route file) is a best-guess pattern match (`"charged"`/`"succeeded"` → success, `"failed"` → failure, etc.), not pinned to verified real Razorpay/Stripe event taxonomies — there's no live account in this environment to confirm exact event names against. Flagged as the one piece of this router that needs recalibration against real webhook payloads before going live, same caveat as the unimplemented checkout call.

## 5. Tests
- [x] All items from the original plan, plus the HTTP-layer webhook test and the data-retention-through-downgrade test.

## Explicit non-tasks here (unchanged)
Business tier — not built (see `product.md` non-goals). Billing settings frontend UI — separate work once this API exists.
