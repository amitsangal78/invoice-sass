# Design — Subscription Billing (Tenant → Platform)

> Builds on `identity-and-rbac/design.md` (`requireOwner` middleware).
> Structurally separate from `core-invoicing`'s payment webhooks — different
> routes, different tables, enforced at the routing level so the "never
> touch `payments`/`invoices` from this path" rule is a file-boundary, not
> just a code-review convention.

## Resolved decisions

| Open item | Decision | Why |
|---|---|---|
| Pricing numbers vs. provider objects | **Config-driven, not hardcoded.** Plan/price identifiers come from environment variables (`RAZORPAY_PLAN_STARTER_ID`, `RAZORPAY_PLAN_PRO_ID`, etc.), never literal amounts in code. `product.md`'s numbers are a working draft — this design makes the actual figures a deploy-time config concern, not a code change, so finalizing pricing later requires zero code changes. |
| Downgrade / grace period | A **`PAST_DUE`** status, distinct from `ACTIVE`/`CANCELLED`. First payment failure → `PAST_DUE`, plan limits **unchanged** (per requirements — no immediate restriction). Only the provider's final "subscription ended" webhook (after its own retry/dunning cycle) → `CANCELLED`, plan reverts to `FREE`. Data is never deleted on downgrade — a Pro workspace with 10 clients that drops to Free simply can't *add* an 11th; existing data stays fully intact and readable. | Matches requirements exactly; `PAST_DUE` as its own status (not reusing `CANCELLED` or a boolean flag) makes "are we mid-grace-period" a direct query, not inferred from webhook timestamps. |
| Owner-only billing actions | Confirmed — every route below requires `requireOwner` from `identity-and-rbac`, not `requireRole('ADMIN')`. | |

## Data model

```ts
// packages/db/schema/subscriptions.ts

export const planEnum = pgEnum('plan', ['FREE', 'STARTER', 'PRO']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['ACTIVE', 'PAST_DUE', 'CANCELLED']);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }).unique(),
  plan: planEnum('plan').notNull().default('FREE'),
  status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
  provider: text('provider'),                       // 'razorpay' | 'stripe' | null while on FREE
  providerSubscriptionId: text('provider_subscription_id'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const subscriptionWebhookEvents = pgTable('subscription_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerEventId: text('provider_event_id').notNull().unique(),   // separate dedupe ledger from core-invoicing's webhookEvents — different event universe entirely
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
});
```

A `subscriptions` row is created (plan `FREE`, status `ACTIVE`) at the same time as the `workspaces` row — this is a second responsibility added to `identity-and-rbac`'s `signup()` service, noted there rather than duplicated.

## Plan limits config (`apps/api/src/config/plan-limits.ts`)

```ts
export const PLAN_LIMITS = {
  FREE:    { maxClients: 3,         maxInvoicesPerMonth: 5,         autoReminders: false, recurringInvoices: false, customBranding: false, maxTeamMembers: 1 },
  STARTER: { maxClients: 25,        maxInvoicesPerMonth: 50,        autoReminders: true,  recurringInvoices: false, customBranding: true,  maxTeamMembers: Infinity },
  PRO:     { maxClients: Infinity,  maxInvoicesPerMonth: Infinity,  autoReminders: true,  recurringInvoices: true,  customBranding: true,  maxTeamMembers: Infinity },
} as const;
```
One file, one source of truth — every gated action (`core-invoicing`'s invoice/client creation and reminder job, `identity-and-rbac`'s team-invite flow) calls `checkPlanLimit()` below rather than reading this config directly, so the check logic (including the Free-vs-PAST_DUE distinction) lives in one place.

```ts
// services/subscriptions/check-plan-limit.ts
async function checkPlanLimit(workspaceId: string, action: keyof PlanLimits): Promise<void> {
  const sub = await getSubscriptionCached(workspaceId);   // Redis-cached, TTL 5–15 min, same pattern as permissions cache
  const limits = PLAN_LIMITS[sub.plan];
  // ... compare current usage (count query) against the relevant limit ...
  if (exceeded) throw new PlanLimitExceededError(action, sub.plan);  // caught by route error middleware → { error: { code: 'plan_limit_exceeded', message, upgradeUrl } }
}
```
This is the function `core-invoicing`'s `createInvoice()`/`createClient()` and the reminder job currently call as a stub (per that spec's `tasks.md`) — implementing it here unblocks those.

## Checkout & webhook routes (`apps/api/src/routes/billing/`)

```
POST /billing/checkout { plan: 'STARTER' | 'PRO' }        [requireOwner]
  → create/reuse a Razorpay/Stripe customer for the workspace
  → create a subscription-checkout session against the env-configured plan/price id
  → 200 { checkoutUrl }

POST /billing/cancel                                       [requireOwner]
  → sets cancelAtPeriodEnd = true on the provider's subscription (not an immediate cancel)
  → local subscriptions row unchanged until the provider's webhook confirms period end

GET /billing/plan                                           [any workspace member — read-only]
  → { plan, status, currentPeriodEnd, manageUrl }  — this is the endpoint the mobile app calls (requirements story 4); manageUrl points to the web billing settings page

POST /webhooks/razorpay/subscriptions, POST /webhooks/stripe/subscriptions   [public, signature-verified]
  → verify signature → dedupe via subscriptionWebhookEvents (own table, own dedupe universe — see above)
  → branch on event type:
      payment succeeded / subscription renewed  → status ACTIVE, update currentPeriodEnd
      payment failed                             → status PAST_DUE (plan unchanged)
      subscription ended (post-dunning)          → status CANCELLED, plan → FREE
      plan changed                               → update plan
  → ONLY writes to `subscriptions` — never `payments`, never `invoices`, never `invoice_events`
```

The route file boundary (`routes/billing/webhooks.ts` vs. `core-invoicing`'s `routes/webhooks/payments.ts`) is the enforcement mechanism for "never touch payments/invoices from this path" — a reviewer sees instantly which file they're in, rather than needing to trace conditional logic inside one shared handler.

## Mobile

`GET /billing/plan` is the entire mobile-facing surface for this spec — no checkout, no cancel, no card entry, per requirements story 4 and `product.md`'s explicit IAP exclusion.

## Testing requirements for this spec

- Plan limit enforcement: exceeding each limit in `PLAN_LIMITS` (clients, invoices/month, reminders, recurring, branding, team members) rejects with `plan_limit_exceeded`, not a generic error.
- Webhook dedupe: same `providerEventId` twice → second call no-ops (own ledger, independent of `core-invoicing`'s `webhookEvents`).
- Downgrade path: `payment failed` → `PAST_DUE` with plan unchanged (existing data/limits untouched); subsequent `subscription ended` → `CANCELLED` + plan `FREE`; a workspace already over the Free limit (e.g. 10 clients) after downgrade can view all 10 but cannot create an 11th.
- `requireOwner` denial: a non-owner ADMIN calling `/billing/checkout` or `/billing/cancel` → 403.
