import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, reminderEvents, subscriptions } from '@invoice-saas/db';
import { sendReminders } from './send-reminders';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../test/fixtures';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function upgradeToStarter(workspaceId: string) {
  await db.update(subscriptions).set({ plan: 'STARTER' }).where(eq(subscriptions.workspaceId, workspaceId));
}

describe('sendReminders — dedupe and plan gating', () => {
  it('should skip a Free-plan workspace entirely (reminders are plan-gated)', async () => {
    const ws = await createTestWorkspace('reminderfree@example.com'); // stays on default FREE plan
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(0) }); // matches the "on due date" rule (offset 0)

    const sentCount = await sendReminders();
    expect(sentCount).toBe(0);
  });

  it('should send a reminder for an invoice matching a rule offset, on a paid plan', async () => {
    const ws = await createTestWorkspace('reminderpaid@example.com');
    await upgradeToStarter(ws.workspaceId);
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(0) }); // due today — matches the seeded offset-0 rule

    const sentCount = await sendReminders();
    expect(sentCount).toBe(1);
  });

  it('should never send the same (invoice, rule) reminder twice', async () => {
    const ws = await createTestWorkspace('reminderdupe@example.com');
    await upgradeToStarter(ws.workspaceId);
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(0) });

    const first = await sendReminders();
    const second = await sendReminders(); // same day, same invoice, same rule

    expect(first).toBe(1);
    expect(second).toBe(0);

    const events = await db.select().from(reminderEvents).where(eq(reminderEvents.invoiceId, invoice.id));
    expect(events).toHaveLength(1);
  });

  it('should not send a reminder for an invoice whose due date does not match any rule offset', async () => {
    const ws = await createTestWorkspace('remindernomatch@example.com');
    await upgradeToStarter(ws.workspaceId);
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(50) }); // no rule matches +50 days

    const sentCount = await sendReminders();
    expect(sentCount).toBe(0);
  });
});
