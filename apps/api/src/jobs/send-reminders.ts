import { and, eq, inArray } from 'drizzle-orm';
import { db, invoices, clients, reminderRules, reminderEvents, subscriptions } from '@invoice-saas/db';
import { sendEmail } from '../lib/email';
import { writeAuditEvent } from '../lib/audit';
import { PLAN_LIMITS } from '../config/plan-limits';

/**
 * Daily reminder cascade. Dedupe is guaranteed by the unique
 * (invoiceId, ruleId) constraint on reminder_events, not by this query alone
 * — the insert-with-onConflictDoNothing below is the actual correctness
 * mechanism; the date-matching query is just an efficiency filter
 * (core-invoicing/design.md).
 */
export async function sendReminders(): Promise<number> {
  const rules = await db.select().from(reminderRules).where(eq(reminderRules.isEnabled, true));
  let sentCount = 0;

  for (const rule of rules) {
    const [sub] = await db.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.workspaceId, rule.workspaceId));
    if (!sub || !PLAN_LIMITS[sub.plan].autoReminders) continue; // Free plan — reminders disabled

    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - rule.offsetDays);
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    const candidates = await db
      .select({ id: invoices.id, clientId: invoices.clientId, invoiceNumber: invoices.invoiceNumber, workspaceId: invoices.workspaceId })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, rule.workspaceId), eq(invoices.dueDate, targetDateStr), inArray(invoices.status, ['SENT', 'OVERDUE', 'PARTIALLY_PAID'])));

    for (const invoice of candidates) {
      const [reserved] = await db.insert(reminderEvents).values({ invoiceId: invoice.id, ruleId: rule.id }).onConflictDoNothing().returning();
      if (!reserved) continue; // already sent for this (invoice, rule) pair

      const client = await db.query.clients.findFirst({ where: eq(clients.id, invoice.clientId) });
      if (!client) continue;

      await sendEmail(client.email, `Reminder: Invoice ${invoice.invoiceNumber}`, `This is a reminder about invoice ${invoice.invoiceNumber}.`);
      await writeAuditEvent(db, { event: 'REMINDER_SENT', workspaceId: invoice.workspaceId, invoiceId: invoice.id });
      sentCount += 1;
    }
  }

  return sentCount;
}
