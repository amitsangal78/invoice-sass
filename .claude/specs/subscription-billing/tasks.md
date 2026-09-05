# Tasks — Subscription Billing

Depends on `identity-and-rbac` (`requireOwner`, `signup()` to extend).

## 1. Schema & migration
- [ ] `packages/db/schema/subscriptions.ts` — `subscriptions`, `subscriptionWebhookEvents`.
- [ ] Extend `identity-and-rbac`'s `signup()` to also insert a `FREE`/`ACTIVE` `subscriptions` row for the new workspace — note this addition there when implementing, don't create a second workspace-creation path.

## 2. Plan limits (`config/plan-limits.ts`, `services/subscriptions/`) — depends on 1
- [ ] `PLAN_LIMITS` config per `design.md`.
- [ ] `getSubscriptionCached()` — Redis-cached read, same TTL pattern as the permissions cache.
- [ ] `checkPlanLimit()` — implements the stub that `core-invoicing`'s `createInvoice()`/`createClient()`/reminder job currently throw `NotImplementedError` on; wire those call sites to the real implementation once this lands.
- [ ] Test: every limit in `PLAN_LIMITS` enforced correctly at the boundary (e.g. exactly 3 clients allowed on Free, 4th rejected).

## 3. Checkout & cancel routes (`routes/billing/`) — depends on 2
- [ ] `POST /billing/checkout` — `requireOwner`, env-configured plan/price ids, never hardcoded amounts.
- [ ] `POST /billing/cancel` — sets `cancelAtPeriodEnd`, no immediate downgrade.
- [ ] `GET /billing/plan` — read-only, any workspace member (this is the mobile-facing endpoint).
- [ ] Test: non-owner ADMIN gets 403 on checkout/cancel.

## 4. Subscription webhooks (`routes/webhooks/subscriptions.ts`) — depends on 1, 2
- [ ] Razorpay + Stripe handlers, own dedupe ledger (`subscriptionWebhookEvents`), branch per `design.md`'s event-type table.
- [ ] `PAST_DUE` on first failure (plan unchanged), `CANCELLED` + revert to `FREE` only on the provider's final "subscription ended" event.
- [ ] Kept in a file/route separate from `core-invoicing`'s payment webhooks — never share a handler.
- [ ] Test: dedupe (same `providerEventId` twice), full downgrade path (`ACTIVE` → `PAST_DUE` → `CANCELLED` → plan `FREE`), data retained (over-limit workspace can still read all existing records post-downgrade).

## 5. Tests — cross-cutting
- [ ] All items called out in `design.md`'s Testing requirements not already covered above.

## Explicit non-tasks here
Business tier — not built (see `product.md` non-goals). Billing settings frontend UI — separate work once this API exists.
