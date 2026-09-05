import { eq } from 'drizzle-orm';
import { db, subscriptions, subscriptionWebhookEvents, type Plan } from '@invoice-saas/db';
import { invalidateCache } from '../../lib/redis';
import { ApiHttpError } from '../../lib/errors';

export interface CheckoutResult {
  checkoutUrl: string;
}

/**
 * Env-configured plan/price ids, never hardcoded amounts — product.md's
 * pricing is a working draft, so finalizing it later is a config change,
 * not a code change (subscription-billing/design.md's resolved decision).
 * The actual provider call is a documented boundary (like core-invoicing's
 * createRazorpayOrder) — this environment has no live credentials to call
 * out to, so it throws rather than silently faking a checkout URL.
 */
export async function initiateCheckout(_workspaceId: string, _plan: Exclude<Plan, 'FREE'>): Promise<CheckoutResult> {
  throw new ApiHttpError(501, 'not_implemented', 'Checkout requires live Razorpay/Stripe credentials — not available in this environment.');
}

/** Sets cancelAtPeriodEnd only — the local `subscriptions` row is NOT
 * downgraded immediately. The plan stays active until the provider's webhook
 * confirms the period actually ended (design.md's resolved decision: data
 * retained, no immediate restriction). */
export async function cancelSubscription(workspaceId: string): Promise<void> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  if (!sub) throw new ApiHttpError(404, 'subscription_not_found', 'No subscription found for this workspace.');
  if (sub.plan === 'FREE') throw new ApiHttpError(400, 'already_free', 'This workspace is already on the Free plan.');

  await db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, workspaceId));
}

export async function getSubscription(workspaceId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  if (!sub) throw new ApiHttpError(404, 'subscription_not_found', 'No subscription found for this workspace.');
  return sub;
}

export type SubscriptionWebhookEventType = 'payment_succeeded' | 'payment_failed' | 'subscription_ended' | 'plan_changed';

export interface SubscriptionWebhookInput {
  provider: 'razorpay' | 'stripe';
  providerEventId: string;
  eventType: SubscriptionWebhookEventType;
  workspaceId: string;
  newPlan?: Plan; // only present for plan_changed
  currentPeriodEnd?: Date;
}

/**
 * Structurally separate from core-invoicing's payment webhook path — its own
 * dedupe ledger, and this function ONLY ever writes to `subscriptions`, never
 * `payments`/`invoices` (subscription-billing/design.md, and the domain
 * skill's "never conflate the two" rule).
 */
export async function processSubscriptionWebhook(input: SubscriptionWebhookInput): Promise<{ deduped: boolean }> {
  const alreadyProcessed = await db.query.subscriptionWebhookEvents.findFirst({ where: eq(subscriptionWebhookEvents.providerEventId, input.providerEventId) });
  if (alreadyProcessed) return { deduped: true };

  await db.insert(subscriptionWebhookEvents).values({ providerEventId: input.providerEventId, provider: input.provider, eventType: input.eventType });

  switch (input.eventType) {
    case 'payment_succeeded':
      await db.update(subscriptions).set({ status: 'ACTIVE', currentPeriodEnd: input.currentPeriodEnd, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, input.workspaceId));
      break;
    case 'payment_failed':
      // PAST_DUE only — plan limits stay unchanged, per design.md: no
      // restriction on first failure, only after the provider's own
      // dunning/retry cycle ends (the subscription_ended event below).
      await db.update(subscriptions).set({ status: 'PAST_DUE', updatedAt: new Date() }).where(eq(subscriptions.workspaceId, input.workspaceId));
      break;
    case 'subscription_ended':
      // The provider's final signal after exhausting retries — downgrade to
      // Free now. Data is never deleted; a workspace already over the Free
      // limit simply can't create more until it's back within limits.
      await db.update(subscriptions).set({ status: 'CANCELLED', plan: 'FREE', updatedAt: new Date() }).where(eq(subscriptions.workspaceId, input.workspaceId));
      break;
    case 'plan_changed':
      if (input.newPlan) {
        await db.update(subscriptions).set({ plan: input.newPlan, status: 'ACTIVE', updatedAt: new Date() }).where(eq(subscriptions.workspaceId, input.workspaceId));
      }
      break;
  }

  await invalidateCache(`workspace:${input.workspaceId}:plan`);
  return { deduped: false };
}
