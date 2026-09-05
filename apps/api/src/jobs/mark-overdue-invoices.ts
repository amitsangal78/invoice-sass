import { and, eq, lt } from 'drizzle-orm';
import { db, invoices } from '@invoice-saas/db';
import { setInvoiceStatus } from '../services/invoicing/status';
import { writeAuditEvent } from '../lib/audit';
import { invalidateCache } from '../lib/redis';
import { publishWorkspaceEvent } from '../lib/sse';

/**
 * Never a user action — a scheduled job is the only thing allowed to flip
 * SENT -> OVERDUE (core-invoicing/design.md's state machine rule). Runs
 * daily in production (see jobs/scheduler.ts); exported as a plain function
 * so it's directly testable without a running BullMQ worker.
 */
export async function markOverdueInvoices(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // date-only, matches the `date` column type

  const due = await db
    .select({ id: invoices.id, workspaceId: invoices.workspaceId, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.status, 'SENT'), lt(invoices.dueDate, today)));

  for (const invoice of due) {
    await setInvoiceStatus(db, invoice.id, invoice.status, 'OVERDUE');
    await invalidateCache(`workspace:${invoice.workspaceId}:invoice:${invoice.id}`);
    await invalidateCache(`workspace:${invoice.workspaceId}:dashboard`);
    await writeAuditEvent(db, { event: 'INVOICE_UPDATED', workspaceId: invoice.workspaceId, invoiceId: invoice.id, oldValue: { status: 'SENT' }, newValue: { status: 'OVERDUE' } });
    publishWorkspaceEvent(invoice.workspaceId, { event: 'invoice.updated', invoiceId: invoice.id, status: 'OVERDUE' });
  }

  return due.length;
}
