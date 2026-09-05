import { Router, type Router as RouterType } from 'express';
import { verifyRazorpaySignature, type RazorpayPaymentWebhookPayload } from '../services/payments/providers/razorpay';
import { verifyStripeSignature, type StripePaymentWebhookPayload } from '../services/payments/providers/stripe';
import { processPaymentWebhook } from '../services/payments/process-webhook';
import { getEnv } from '../lib/env';
import { ApiHttpError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';

export const webhooksRouter: RouterType = Router();

// Public, signature-verified instead of authenticated — rate-limited at the
// app level (tech.md). Raw body is required for signature verification, so
// this router is mounted BEFORE express.json() in app.ts. Limit is generous
// (per-IP, not per-account) since legitimate provider traffic is bursty and
// comes from a small set of provider IPs, not end users.
const webhookRateLimit = rateLimit({ keyPrefix: 'webhook', max: 200, windowSeconds: 60 });

webhooksRouter.post('/razorpay', webhookRateLimit, async (req, res, next) => {
  try {
    const rawBody = req.body as Buffer;
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !verifyRazorpaySignature(rawBody.toString('utf8'), signature, getEnv().RAZORPAY_WEBHOOK_SECRET)) {
      throw new ApiHttpError(400, 'invalid_signature', 'Invalid Razorpay webhook signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as RazorpayPaymentWebhookPayload;
    const payment = payload.payload.payment.entity;
    const invoiceId = payment.notes?.invoiceId;
    if (!invoiceId) throw new ApiHttpError(400, 'missing_invoice_reference', 'Webhook payload did not reference an invoice.');

    await processPaymentWebhook({
      provider: 'razorpay',
      providerEventId: payment.id,
      eventType: payload.event,
      invoiceId,
      amount: (payment.amount / 100).toFixed(2), // paise -> major unit
    });

    res.status(200).json({ data: { received: true } });
  } catch (err) {
    next(err);
  }
});

webhooksRouter.post('/stripe', webhookRateLimit, async (req, res, next) => {
  try {
    const rawBody = req.body as Buffer;
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !verifyStripeSignature(rawBody.toString('utf8'), signature, getEnv().STRIPE_WEBHOOK_SECRET)) {
      throw new ApiHttpError(400, 'invalid_signature', 'Invalid Stripe webhook signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as StripePaymentWebhookPayload;
    const object = payload.data.object;
    const invoiceId = object.metadata?.invoiceId;
    if (!invoiceId) throw new ApiHttpError(400, 'missing_invoice_reference', 'Webhook payload did not reference an invoice.');

    await processPaymentWebhook({
      provider: 'stripe',
      providerEventId: object.id,
      eventType: payload.type,
      invoiceId,
      amount: (object.amount / 100).toFixed(2), // cents -> major unit
    });

    res.status(200).json({ data: { received: true } });
  } catch (err) {
    next(err);
  }
});
