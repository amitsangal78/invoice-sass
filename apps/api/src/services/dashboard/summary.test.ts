import { describe, expect, it } from 'vitest';
import { db, payments } from '@invoice-saas/db';
import { eq } from 'drizzle-orm';
import { getDashboardSummary } from './summary';
import { listInvoices } from '../invoicing/invoices';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../../test/fixtures';
import { invalidateCache } from '../../lib/redis';

/** The summary is Redis-cached for 60s; every test writes rows directly and
 * then reads, so the cache has to be dropped or the assertions test the
 * previous test's data. */
async function summaryFor(workspaceId: string) {
  await invalidateCache(`workspace:${workspaceId}:dashboard`);
  return getDashboardSummary(workspaceId);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const amountFor = (rows: { currency: string; amount: string }[], currency: string) =>
  Number(rows.find((r) => r.currency === currency)?.amount ?? 0);

describe('getDashboardSummary', () => {
  it('should report an OVERDUE invoice under overdue, not due soon', async () => {
    const ws = await createTestWorkspace('dash-overdue@example.com');
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { total: '65000.00', status: 'OVERDUE', dueDate: daysFromNow(-3) });

    const summary = await summaryFor(ws.workspaceId);

    expect(amountFor(summary.overdue, 'INR')).toBe(65000);
    expect(amountFor(summary.dueSoon, 'INR')).toBe(0);
  });

  it('should count a SENT invoice falling due within 7 days as due soon', async () => {
    const ws = await createTestWorkspace('dash-duesoon@example.com');
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { total: '80000.00', status: 'SENT', dueDate: daysFromNow(3) });
    // Outside the window — must not be counted.
    await createTestInvoice(ws.workspaceId, client.id, { total: '99000.00', status: 'SENT', dueDate: daysFromNow(30) });

    const summary = await summaryFor(ws.workspaceId);

    expect(amountFor(summary.dueSoon, 'INR')).toBe(80000);
  });

  it('should count only payments made this month under paidThisMonth', async () => {
    const ws = await createTestWorkspace('dash-paidmonth@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '50000.00', status: 'PAID' });

    await db.insert(payments).values({ invoiceId: invoice.id, amount: '30000.00', source: 'MANUAL' });
    const [old] = await db.insert(payments).values({ invoiceId: invoice.id, amount: '20000.00', source: 'MANUAL' }).returning();
    // Backdate one payment into a previous month.
    await db
      .update(payments)
      .set({ paidAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 15)) })
      .where(eq(payments.id, old!.id));

    const summary = await summaryFor(ws.workspaceId);

    expect(amountFor(summary.paidThisMonth, 'INR')).toBe(30000);
  });

  it('should never sum different currencies into one figure', async () => {
    const ws = await createTestWorkspace('dash-currency@example.com');
    const client = await createTestClient(ws.workspaceId);
    await createTestInvoice(ws.workspaceId, client.id, { total: '50000.00', status: 'SENT', currency: 'INR', dueDate: daysFromNow(2) });
    await createTestInvoice(ws.workspaceId, client.id, { total: '2000.00', status: 'SENT', currency: 'USD', dueDate: daysFromNow(2) });

    const summary = await summaryFor(ws.workspaceId);

    expect(summary.dueSoon).toHaveLength(2);
    expect(amountFor(summary.dueSoon, 'INR')).toBe(50000);
    expect(amountFor(summary.dueSoon, 'USD')).toBe(2000);
  });

  it('should return recent payments newest-first with the client name', async () => {
    const ws = await createTestWorkspace('dash-recent@example.com');
    const client = await createTestClient(ws.workspaceId, { name: 'Acme Ltd' });
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '45000.00' });

    const [older] = await db.insert(payments).values({ invoiceId: invoice.id, amount: '5000.00', source: 'MANUAL' }).returning();
    await db
      .update(payments)
      .set({ paidAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) })
      .where(eq(payments.id, older!.id));
    await db.insert(payments).values({ invoiceId: invoice.id, amount: '40000.00', source: 'MANUAL' });

    const summary = await summaryFor(ws.workspaceId);

    expect(summary.recentPayments).toHaveLength(2);
    expect(summary.recentPayments[0]!.clientName).toBe('Acme Ltd');
    expect(Number(summary.recentPayments[0]!.amount)).toBe(40000); // newest first
    expect(summary.recentPayments[0]!.currency).toBe('INR');
  });

  it('should bucket the revenue trend by month', async () => {
    const ws = await createTestWorkspace('dash-trend@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '90000.00' });

    await db.insert(payments).values({ invoiceId: invoice.id, amount: '10000.00', source: 'MANUAL' });
    const [prev] = await db.insert(payments).values({ invoiceId: invoice.id, amount: '25000.00', source: 'MANUAL' }).returning();
    await db
      .update(payments)
      .set({ paidAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10)) })
      .where(eq(payments.id, prev!.id));

    const summary = await summaryFor(ws.workspaceId);

    expect(summary.revenueTrend).toHaveLength(2);
    // Ordered oldest → newest, so the backdated month leads.
    expect(Number(summary.revenueTrend[0]!.amount)).toBe(25000);
    expect(Number(summary.revenueTrend[1]!.amount)).toBe(10000);
  });

  it('should not leak another workspace figures', async () => {
    const mine = await createTestWorkspace('dash-mine@example.com');
    const theirs = await createTestWorkspace('dash-theirs@example.com');
    const theirClient = await createTestClient(theirs.workspaceId);
    await createTestInvoice(theirs.workspaceId, theirClient.id, { total: '77000.00', status: 'OVERDUE' });

    const summary = await summaryFor(mine.workspaceId);

    expect(summary.overdue).toHaveLength(0);
    expect(summary.recentPayments).toHaveLength(0);
  });
});

describe('listInvoices', () => {
  it('should include the client name for each invoice', async () => {
    const ws = await createTestWorkspace('dash-listinv@example.com');
    const client = await createTestClient(ws.workspaceId, { name: 'Globex Pvt Ltd' });
    await createTestInvoice(ws.workspaceId, client.id, { total: '1000.00' });

    const rows = await listInvoices(ws.workspaceId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientName).toBe('Globex Pvt Ltd');
    expect(rows[0]!.invoiceNumber).toBeTruthy();
  });
});
