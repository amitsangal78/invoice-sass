import { createHmac, timingSafeEqual } from 'node:crypto';

// Behind a small interface (verifyWebhook / createPaymentLink) rather than
// branching provider-specific code through the invoice logic — Razorpay for
// India, Stripe internationally, same call sites (domain skill).

export function verifyRazorpaySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

export interface RazorpayPaymentWebhookPayload {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        amount: number; // paise
        notes?: { invoiceId?: string };
      };
    };
  };
}

/** Real order/checkout-session creation is an external API call — left as a
 * documented boundary rather than mocked here; see tasks.md follow-up. */
export async function createRazorpayOrder(_amount: string, _currency: string, _invoiceId: string): Promise<{ orderId: string }> {
  throw new Error('createRazorpayOrder requires live Razorpay credentials — not called in tests.');
}
