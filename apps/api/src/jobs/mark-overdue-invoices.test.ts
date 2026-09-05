import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, invoices } from '@invoice-saas/db';
import { markOverdueInvoices } from './mark-overdue-invoices';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../test/fixtures';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('markOverdueInvoices — scheduled job, never a user action', () => {
  it('should flip a SENT invoice past its due date to OVERDUE', async () => {
    const ws = await createTestWorkspace('overdue1@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(-5) });

    const count = await markOverdueInvoices();
    expect(count).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('OVERDUE');
  });

  it('should not touch a SENT invoice that is not yet due', async () => {
    const ws = await createTestWorkspace('overdue2@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'SENT', dueDate: daysFromNow(5) });

    await markOverdueInvoices();

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('SENT');
  });

  it('should not touch a DRAFT invoice even if its due date has passed', async () => {
    const ws = await createTestWorkspace('overdue3@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'DRAFT', dueDate: daysFromNow(-5) });

    await markOverdueInvoices();

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('DRAFT');
  });

  it('should not touch a PAID invoice even if its due date has passed', async () => {
    const ws = await createTestWorkspace('overdue4@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'PAID', dueDate: daysFromNow(-5) });

    await markOverdueInvoices();

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe('PAID');
  });
});
