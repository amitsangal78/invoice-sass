import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, payments, invoices } from '@invoice-saas/db';
import { processPaymentWebhook } from './process-webhook';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../../test/fixtures';
import { verifyRazorpaySignature } from './providers/razorpay';
import { verifyStripeSignature } from './providers/stripe';
import { createHmac } from 'node:crypto';

describe('processPaymentWebhook — redelivery safety', () => {
  it('should record a payment and update invoice status on first delivery', async () => {
    const ws = await createTestWorkspace('webhook1@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '500.00', status: 'SENT' });

    const result = await processPaymentWebhook({
      provider: 'razorpay',
      providerEventId: 'evt_unique_1',
      eventType: 'payment.captured',
      invoiceId: invoice.id,
      amount: '500.00',
    });

    expect(result.deduped).toBe(false);
    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('PAID');

    const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(paymentRows).toHaveLength(1);
  });

  it('should no-op on a redelivered event — no duplicate payment row, same status', async () => {
    const ws = await createTestWorkspace('webhook2@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '500.00', status: 'SENT' });

    const input = { provider: 'razorpay' as const, providerEventId: 'evt_redelivered', eventType: 'payment.captured', invoiceId: invoice.id, amount: '500.00' };

    const first = await processPaymentWebhook(input);
    const second = await processPaymentWebhook(input); // exact same provider event id, redelivered

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);

    const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(paymentRows).toHaveLength(1); // still just one payment, not two
  });

  it('should treat two different event ids for the same invoice as two separate payments (partial payments)', async () => {
    const ws = await createTestWorkspace('webhook3@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '1000.00', status: 'SENT' });

    await processPaymentWebhook({ provider: 'razorpay', providerEventId: 'evt_a', eventType: 'payment.captured', invoiceId: invoice.id, amount: '600.00' });
    await processPaymentWebhook({ provider: 'razorpay', providerEventId: 'evt_b', eventType: 'payment.captured', invoiceId: invoice.id, amount: '400.00' });

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('PAID');
  });
});

describe('Razorpay signature verification', () => {
  it('should accept a correctly signed payload', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyRazorpaySignature(body, signature, secret)).toBe(true);
  });

  it('should reject a tampered payload', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const tamperedBody = JSON.stringify({ event: 'payment.captured', amount: 999999 });
    expect(verifyRazorpaySignature(tamperedBody, signature, secret)).toBe(false);
  });

  it('should reject a signature made with the wrong secret', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const signature = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(verifyRazorpaySignature(body, signature, 'whsec_test')).toBe(false);
  });
});

describe('Stripe signature verification', () => {
  it('should accept a correctly signed, fresh payload', () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded' });
    const secret = 'whsec_test';
    const timestamp = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${timestamp},v1=${v1}`, secret)).toBe(true);
  });

  it('should reject a signature older than the tolerance window (replay protection)', () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded' });
    const secret = 'whsec_test';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10_000; // way outside the 300s default tolerance
    const v1 = createHmac('sha256', secret).update(`${oldTimestamp}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${oldTimestamp},v1=${v1}`, secret)).toBe(false);
  });

  it('should reject a malformed signature header', () => {
    expect(verifyStripeSignature('{}', 'not-a-valid-header', 'whsec_test')).toBe(false);
  });
});
