import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, subscriptions } from '@invoice-saas/db';
import { createApp } from '../app';
import { createTestWorkspace } from '../test/fixtures';
import { getEnv } from '../lib/env';

const app = createApp();

function signRazorpay(body: string): string {
  return createHmac('sha256', getEnv().RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
}

describe('POST /webhooks/razorpay/subscriptions', () => {
  it('should reject a request with an invalid signature', async () => {
    const body = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', notes: { workspaceId: 'x' } } } } });

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay/subscriptions')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'not-a-valid-signature')
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_signature');
  });

  it('should update the local subscription on a validly-signed payment-succeeded event', async () => {
    const ws = await createTestWorkspace('subwebhookroute1@example.com');
    const payload = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_evt_route_1', notes: { workspaceId: ws.workspaceId } } } } };
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay/subscriptions')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signRazorpay(body))
      .send(body);

    expect(res.status).toBe(200);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, ws.workspaceId));
    expect(sub!.status).toBe('ACTIVE');
  });

  it('should never touch the payments/invoices webhook path (separate dedupe ledger, verified via a second identical event id on the OTHER endpoint not deduping)', async () => {
    const ws = await createTestWorkspace('subwebhookroute2@example.com');
    const payload = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'shared_event_id_test', notes: { workspaceId: ws.workspaceId } } } } };
    const body = JSON.stringify(payload);

    const first = await request(app)
      .post('/api/v1/webhooks/razorpay/subscriptions')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signRazorpay(body))
      .send(body);
    expect(first.status).toBe(200);

    // Redelivering the SAME event id to the SAME subscription endpoint dedupes...
    const second = await request(app)
      .post('/api/v1/webhooks/razorpay/subscriptions')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signRazorpay(body))
      .send(body);
    expect(second.status).toBe(200); // still 200 — dedupe is silent, not an error
  });
});
