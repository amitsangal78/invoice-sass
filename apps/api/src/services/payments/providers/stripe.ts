import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe's own signature scheme: header is `t=<timestamp>,v1=<hex hmac>`;
 * the signed payload is `${timestamp}.${rawBody}`. Implemented directly
 * (no `stripe` SDK dependency) since this is pure HMAC verification.
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(v1, 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

export interface StripePaymentWebhookPayload {
  type: string;
  data: {
    object: {
      id: string;
      amount: number; // cents
      metadata?: { invoiceId?: string };
    };
  };
}

export async function createStripeCheckoutSession(_amount: string, _currency: string, _invoiceId: string): Promise<{ sessionId: string }> {
  throw new Error('createStripeCheckoutSession requires live Stripe credentials — not called in tests.');
}
