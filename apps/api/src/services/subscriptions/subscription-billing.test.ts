import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, subscriptions, subscriptionWebhookEvents, payments, invoices } from '@invoice-saas/db';
import { processSubscriptionWebhook, cancelSubscription, getSubscription } from './subscription-billing';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../../test/fixtures';
import { ApiHttpError } from '../../lib/errors';

async function getSub(workspaceId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  return sub!;
}

describe('subscription webhook — dedupe and downgrade path', () => {
  it('should no-op on a redelivered subscription webhook event', async () => {
    const ws = await createTestWorkspace('subwebhook1@example.com');
    const input = { provider: 'razorpay' as const, providerEventId: 'sub_evt_1', eventType: 'payment_succeeded' as const, workspaceId: ws.workspaceId };

    const first = await processSubscriptionWebhook(input);
    const second = await processSubscriptionWebhook(input);

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);

    const events = await db.select().from(subscriptionWebhookEvents).where(eq(subscriptionWebhookEvents.providerEventId, 'sub_evt_1'));
    expect(events).toHaveLength(1);
  });

  it('should move to PAST_DUE on payment_failed, plan unchanged', async () => {
    const ws = await createTestWorkspace('subdowngrade1@example.com');
    await db.update(subscriptions).set({ plan: 'PRO' }).where(eq(subscriptions.workspaceId, ws.workspaceId));

    await processSubscriptionWebhook({ provider: 'stripe', providerEventId: 'sub_evt_fail_1', eventType: 'payment_failed', workspaceId: ws.workspaceId });

    const sub = await getSub(ws.workspaceId);
    expect(sub.status).toBe('PAST_DUE');
    expect(sub.plan).toBe('PRO'); // no immediate restriction — design.md
  });

  it('should downgrade to CANCELLED + FREE only after subscription_ended (post-dunning)', async () => {
    const ws = await createTestWorkspace('subdowngrade2@example.com');
    await db.update(subscriptions).set({ plan: 'PRO' }).where(eq(subscriptions.workspaceId, ws.workspaceId));

    await processSubscriptionWebhook({ provider: 'stripe', providerEventId: 'sub_evt_fail_2', eventType: 'payment_failed', workspaceId: ws.workspaceId });
    let sub = await getSub(ws.workspaceId);
    expect(sub.status).toBe('PAST_DUE');
    expect(sub.plan).toBe('PRO');

    await processSubscriptionWebhook({ provider: 'stripe', providerEventId: 'sub_evt_ended_1', eventType: 'subscription_ended', workspaceId: ws.workspaceId });
    sub = await getSub(ws.workspaceId);
    expect(sub.status).toBe('CANCELLED');
    expect(sub.plan).toBe('FREE');
  });

  it('should retain all workspace data through a downgrade — an over-limit workspace keeps existing records readable', async () => {
    const ws = await createTestWorkspace('subdataretention@example.com');
    await db.update(subscriptions).set({ plan: 'PRO' }).where(eq(subscriptions.workspaceId, ws.workspaceId));
    const client = await createTestClient(ws.workspaceId);
    // 5 invoices — would exceed the Free plan's monthly limit of 5, but these already exist.
    for (let i = 0; i < 5; i++) await createTestInvoice(ws.workspaceId, client.id);

    await processSubscriptionWebhook({ provider: 'stripe', providerEventId: 'sub_evt_ended_2', eventType: 'subscription_ended', workspaceId: ws.workspaceId });

    const sub = await getSub(ws.workspaceId);
    expect(sub.plan).toBe('FREE');

    const remainingInvoices = await db.select().from(invoices).where(eq(invoices.workspaceId, ws.workspaceId));
    expect(remainingInvoices).toHaveLength(5); // nothing deleted
  });

  it('should update the plan on plan_changed', async () => {
    const ws = await createTestWorkspace('subplanchange@example.com');
    await processSubscriptionWebhook({ provider: 'razorpay', providerEventId: 'sub_evt_change_1', eventType: 'plan_changed', workspaceId: ws.workspaceId, newPlan: 'STARTER' });

    const sub = await getSub(ws.workspaceId);
    expect(sub.plan).toBe('STARTER');
    expect(sub.status).toBe('ACTIVE');
  });

  it('should only ever write to subscriptions, never payments/invoices, from this webhook path', async () => {
    const ws = await createTestWorkspace('subisolation@example.com');
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id);

    const paymentsBefore = await db.select().from(payments);
    await processSubscriptionWebhook({ provider: 'razorpay', providerEventId: 'sub_evt_isolation_1', eventType: 'payment_succeeded', workspaceId: ws.workspaceId });
    const paymentsAfter = await db.select().from(payments);

    expect(paymentsAfter).toHaveLength(paymentsBefore.length); // untouched
  });
});

describe('cancelSubscription', () => {
  it('should set cancelAtPeriodEnd without downgrading the plan immediately', async () => {
    const ws = await createTestWorkspace('subcancel1@example.com');
    await db.update(subscriptions).set({ plan: 'PRO' }).where(eq(subscriptions.workspaceId, ws.workspaceId));

    await cancelSubscription(ws.workspaceId);

    const sub = await getSub(ws.workspaceId);
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.plan).toBe('PRO'); // still active until the period actually ends
  });

  it('should reject cancelling an already-Free subscription', async () => {
    const ws = await createTestWorkspace('subcancel2@example.com'); // stays FREE
    await expect(cancelSubscription(ws.workspaceId)).rejects.toThrow(ApiHttpError);
  });
});

describe('getSubscription', () => {
  it('should return the FREE/ACTIVE default seeded at signup', async () => {
    const ws = await createTestWorkspace('subget1@example.com');
    const sub = await getSubscription(ws.workspaceId);
    expect(sub.plan).toBe('FREE');
    expect(sub.status).toBe('ACTIVE');
  });
});
