import { describe, expect, it } from 'vitest';
import { createInvoice, sendInvoice, recordManualPayment, cancelInvoice } from './invoices';
import { createTestWorkspace, createTestClient } from '../../test/fixtures';
import { ApiHttpError, PlanLimitExceededError, InvalidStatusTransitionError } from '../../lib/errors';

describe('createInvoice', () => {
  it('should compute subtotal/total from line items and start as DRAFT', async () => {
    const ws = await createTestWorkspace('createinv@example.com');
    const client = await createTestClient(ws.workspaceId);

    const invoice = await createInvoice(ws.workspaceId, {
      clientId: client.id,
      currency: 'INR',
      dueDate: '2026-12-31',
      items: [
        { description: 'Design work', quantity: '2', unitPrice: '5000.00' },
        { description: 'Hosting', quantity: '1', unitPrice: '500.50' },
      ],
    });

    expect(invoice!.status).toBe('DRAFT');
    expect(invoice!.subtotal).toBe('10500.50');
    expect(invoice!.total).toBe('10500.50');
    expect(invoice!.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
  });

  it('should apply tax and discount to the total', async () => {
    const ws = await createTestWorkspace('taxdiscount@example.com');
    const client = await createTestClient(ws.workspaceId);

    const invoice = await createInvoice(ws.workspaceId, {
      clientId: client.id,
      currency: 'INR',
      dueDate: '2026-12-31',
      taxAmount: '100.00',
      discountAmount: '50.00',
      items: [{ description: 'Item', quantity: '1', unitPrice: '1000.00' }],
    });

    expect(invoice!.subtotal).toBe('1000.00');
    expect(invoice!.total).toBe('1050.00'); // 1000 + 100 tax - 50 discount
  });

  it('should reject an invoice with no line items', async () => {
    const ws = await createTestWorkspace('nolineitems@example.com');
    const client = await createTestClient(ws.workspaceId);

    await expect(
      createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [] }),
    ).rejects.toThrow(ApiHttpError);
  });

  it('should reject creating a 6th invoice this month on the Free plan', async () => {
    const ws = await createTestWorkspace('invoicelimit@example.com');
    const client = await createTestClient(ws.workspaceId);
    const makeOne = () => createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '10.00' }] });

    for (let i = 0; i < 5; i++) await makeOne();

    await expect(makeOne()).rejects.toThrow(PlanLimitExceededError);
  });
});

describe('invoice lifecycle', () => {
  it('should send a DRAFT invoice and mark it SENT with a timestamp', async () => {
    const ws = await createTestWorkspace('sendflow@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '100.00' }] });

    const sent = await sendInvoice(ws.workspaceId, invoice!.id);
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toBeTruthy();
  });

  it('should record a manual payment and transition status accordingly', async () => {
    const ws = await createTestWorkspace('manualpay@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '1000.00' }] });
    await sendInvoice(ws.workspaceId, invoice!.id);

    const status = await recordManualPayment(ws.workspaceId, invoice!.id, '1000.00', ws.userId);
    expect(status).toBe('PAID');
  });

  it('should reject cancelling a PAID invoice', async () => {
    const ws = await createTestWorkspace('cancelpaid@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '1000.00' }] });
    await sendInvoice(ws.workspaceId, invoice!.id);
    await recordManualPayment(ws.workspaceId, invoice!.id, '1000.00', ws.userId);

    await expect(cancelInvoice(ws.workspaceId, invoice!.id, ws.userId)).rejects.toThrow(InvalidStatusTransitionError);
  });

  it('should allow cancelling a SENT invoice', async () => {
    const ws = await createTestWorkspace('cancelsent@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoice = await createInvoice(ws.workspaceId, { clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '1000.00' }] });
    await sendInvoice(ws.workspaceId, invoice!.id);

    await expect(cancelInvoice(ws.workspaceId, invoice!.id, ws.userId)).resolves.toBeUndefined();
  });
});
