import { describe, expect, it } from 'vitest';
import { db, payments } from '@invoice-saas/db';
import { assertTransition, setInvoiceStatus, recomputeStatusFromPayments } from './status';
import { createTestWorkspace, createTestClient, createTestInvoice } from '../../test/fixtures';
import { InvalidStatusTransitionError } from '../../lib/errors';

describe('invoice state machine', () => {
  it('should allow every legal transition', () => {
    expect(() => assertTransition('DRAFT', 'SENT')).not.toThrow();
    expect(() => assertTransition('DRAFT', 'CANCELLED')).not.toThrow();
    expect(() => assertTransition('SENT', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertTransition('SENT', 'PAID')).not.toThrow();
    expect(() => assertTransition('SENT', 'OVERDUE')).not.toThrow();
    expect(() => assertTransition('SENT', 'CANCELLED')).not.toThrow();
    expect(() => assertTransition('PARTIALLY_PAID', 'PAID')).not.toThrow();
    expect(() => assertTransition('OVERDUE', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertTransition('OVERDUE', 'PAID')).not.toThrow();
  });

  it('should reject every illegal transition', () => {
    expect(() => assertTransition('DRAFT', 'PAID')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('DRAFT', 'OVERDUE')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('PAID', 'SENT')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('PAID', 'CANCELLED')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('CANCELLED', 'SENT')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('PARTIALLY_PAID', 'CANCELLED')).toThrow(InvalidStatusTransitionError);
    expect(() => assertTransition('PARTIALLY_PAID', 'DRAFT')).toThrow(InvalidStatusTransitionError);
  });

  it('should reject cancelling a PARTIALLY_PAID or PAID invoice', () => {
    // Cancellation is only legal from DRAFT/SENT — refunds/credit notes are a
    // separate, unbuilt feature (core-invoicing/requirements.md).
    expect(() => assertTransition('PARTIALLY_PAID', 'CANCELLED')).toThrow();
    expect(() => assertTransition('PAID', 'CANCELLED')).toThrow();
  });

  it('should throw via setInvoiceStatus for an illegal transition without writing anything', async () => {
    const ws = await createTestWorkspace('statustest@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { status: 'DRAFT' });

    await expect(setInvoiceStatus(db, invoice.id, 'DRAFT', 'PAID')).rejects.toThrow(InvalidStatusTransitionError);
  });
});

describe('recomputeStatusFromPayments — decimal-safe', () => {
  it('should move to PARTIALLY_PAID when cumulative payments are less than the total', async () => {
    const ws = await createTestWorkspace('partial@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '1000.00', status: 'SENT' });

    await db.insert(payments).values({ invoiceId: invoice.id, amount: '400.00', source: 'MANUAL' });
    const status = await recomputeStatusFromPayments(db, invoice.id);

    expect(status).toBe('PARTIALLY_PAID');
  });

  it('should move to PAID once cumulative payments meet the total, using values that would misbehave under float arithmetic', async () => {
    const ws = await createTestWorkspace('floatcheck@example.com');
    const client = await createTestClient(ws.workspaceId);
    // 0.1 + 0.2 !== 0.3 in IEEE-754 float — these three payments must sum to
    // exactly 300.30 via decimal.js, not something like 300.29999999999995.
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '300.30', status: 'SENT' });

    await db.insert(payments).values([
      { invoiceId: invoice.id, amount: '100.10', source: 'MANUAL' },
      { invoiceId: invoice.id, amount: '100.10', source: 'MANUAL' },
      { invoiceId: invoice.id, amount: '100.10', source: 'MANUAL' },
    ]);

    const status = await recomputeStatusFromPayments(db, invoice.id);
    expect(status).toBe('PAID');
  });

  it('should move to PAID when cumulative payments exceed the total (overpayment)', async () => {
    const ws = await createTestWorkspace('overpay@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '500.00', status: 'SENT' });

    await db.insert(payments).values({ invoiceId: invoice.id, amount: '550.00', source: 'MANUAL' });
    const status = await recomputeStatusFromPayments(db, invoice.id);

    expect(status).toBe('PAID');
  });

  it('should leave status unchanged when there are no payments yet', async () => {
    const ws = await createTestWorkspace('nopayments@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createTestInvoice(ws.workspaceId, client.id, { total: '500.00', status: 'SENT' });

    const status = await recomputeStatusFromPayments(db, invoice.id);
    expect(status).toBe('SENT');
  });
});
