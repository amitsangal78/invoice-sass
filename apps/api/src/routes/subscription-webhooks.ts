import { Router, type Router as RouterType } from 'express';
import { verifyRazorpaySignature } from '../services/payments/providers/razorpay';
import { verifyStripeSignature } from '../services/payments/providers/stripe';
import { processSubscriptionWebhook, type SubscriptionWebhookEventType } from '../services/subscriptions/subscription-billing';
import { getEnv } from '../lib/env';
import { rateLimit } from '../middleware/rate-limit';
import { ApiHttpError } from '../lib/errors';
import type { Plan } from '@invoice-saas/db';

// Deliberately a SEPARATE router/file from routes/webhooks.ts (core-invoicing's
// invoice-payment webhooks) — the file boundary is what makes "never touch
// payments/invoices from this path" enforceable by inspection, not just
// convention (subscription-billing/design.md).

export const subscriptionWebhooksRouter: RouterType = Router();

const webhookRateLimit = rateLimit({ keyPrefix: 'subscription-webhook', max: 200, windowSeconds: 60 });

// Provider event names vary by provider and aren't pinned to real Razorpay/
// Stripe taxonomies here (no live account to verify exact names against) —
// this mapping is the one place that would need updating against real
// payloads before going live.
function mapEventType(rawType: string): SubscriptionWebhookEventType | null {
  if (rawType.includes('charged') || rawType.includes('succeeded') || rawType.includes('renewed')) return 'payment_succeeded';
  if (rawType.includes('failed')) return 'payment_failed';
  if (rawType.includes('cancelled') || rawType.includes('ended') || rawType.includes('completed')) return 'subscription_ended';
  if (rawType.includes('updated') || rawType.includes('changed')) return 'plan_changed';
  return null;
}

interface SubscriptionWebhookPayload {
  event?: string;
  type?: string;
  data?: { object?: { id?: string; metadata?: { workspaceId?: string; plan?: Plan } } };
  payload?: { subscription?: { entity?: { id?: string; notes?: { workspaceId?: string; plan?: Plan } } } };
}

subscriptionWebhooksRouter.post('/razorpay/subscriptions', webhookRateLimit, async (req, res, next) => {
  try {
    const rawBody = req.body as Buffer;
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !verifyRazorpaySignature(rawBody.toString('utf8'), signature, getEnv().RAZORPAY_WEBHOOK_SECRET)) {
      throw new ApiHttpError(400, 'invalid_signature', 'Invalid Razorpay webhook signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as SubscriptionWebhookPayload;
    const entity = payload.payload?.subscription?.entity;
    const rawType = payload.event ?? '';
    const mapped = mapEventType(rawType);
    const workspaceId = entity?.notes?.workspaceId;

    if (!mapped || !entity?.id || !workspaceId) {
      throw new ApiHttpError(400, 'unrecognized_event', 'Webhook payload missing required fields.');
    }

    await processSubscriptionWebhook({ provider: 'razorpay', providerEventId: entity.id, eventType: mapped, workspaceId, newPlan: entity.notes?.plan });
    res.status(200).json({ data: { received: true } });
  } catch (err) {
    next(err);
  }
});

subscriptionWebhooksRouter.post('/stripe/subscriptions', webhookRateLimit, async (req, res, next) => {
  try {
    const rawBody = req.body as Buffer;
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !verifyStripeSignature(rawBody.toString('utf8'), signature, getEnv().STRIPE_WEBHOOK_SECRET)) {
      throw new ApiHttpError(400, 'invalid_signature', 'Invalid Stripe webhook signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as SubscriptionWebhookPayload;
    const object = payload.data?.object;
    const rawType = payload.type ?? '';
    const mapped = mapEventType(rawType);
    const workspaceId = object?.metadata?.workspaceId;

    if (!mapped || !object?.id || !workspaceId) {
      throw new ApiHttpError(400, 'unrecognized_event', 'Webhook payload missing required fields.');
    }

    await processSubscriptionWebhook({ provider: 'stripe', providerEventId: object.id, eventType: mapped, workspaceId, newPlan: object.metadata?.plan });
    res.status(200).json({ data: { received: true } });
  } catch (err) {
    next(err);
  }
});
