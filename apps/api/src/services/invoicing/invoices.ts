import { and, desc, eq } from 'drizzle-orm';
import { db, invoices, invoiceItems, payments, clients, type InvoiceStatus } from '@invoice-saas/db';
import { toDecimal, multiply, sum, toDbString } from '../../lib/money/decimal';
import { generateInvoiceNumber } from './generate-invoice-number';
import { setInvoiceStatus, recomputeStatusFromPayments } from './status';
import { checkPlanLimit } from '../subscriptions/check-plan-limit';
import { writeAuditEvent } from '../../lib/audit';
import { cacheAside, invalidateCache } from '../../lib/redis';
import { sendEmail } from '../../lib/email';
import { generateInvoicePdf } from './pdf';
import { generateReceiptForPayment } from './receipts';
import { ApiHttpError } from '../../lib/errors';

// A finalized invoice's PDF content never changes again — updateInvoice/
// deleteInvoice below only allow edits while still DRAFT — so a long TTL here
// is safe, not just fast. Longer than the usual Redis entries in this codebase
// precisely because the content is immutable; see tech.md's Redis conventions.
const PDF_CACHE_TTL_SECONDS = 15 * 24 * 60 * 60;

export interface InvoiceLineItemInput {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface CreateInvoiceInput {
  clientId: string;
  currency: string;
  dueDate: string;
  taxAmount?: string;
  discountAmount?: string;
  items: InvoiceLineItemInput[];
}

async function assertClientBelongsToWorkspace(workspaceId: string, clientId: string): Promise<void> {
  const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)));
  if (!client) throw new ApiHttpError(404, 'client_not_found', 'Client not found in this workspace.');
}

async function assertInvoiceInWorkspace(workspaceId: string, invoiceId: string) {
  const invoice = await db.query.invoices.findFirst({ where: and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)) });
  if (!invoice) throw new ApiHttpError(404, 'invoice_not_found', 'Invoice not found in this workspace.');
  return invoice;
}

export async function createInvoice(workspaceId: string, input: CreateInvoiceInput) {
  if (input.items.length === 0) {
    throw new ApiHttpError(400, 'no_line_items', 'An invoice needs at least one line item.');
  }
  await assertClientBelongsToWorkspace(workspaceId, input.clientId);
  await checkPlanLimit(workspaceId, 'create_invoice');

  const lineAmounts = input.items.map((item) => multiply(item.quantity, item.unitPrice));
  const subtotal = sum(lineAmounts.map((d) => d.toString()));
  const tax = toDecimal(input.taxAmount ?? '0');
  const discount = toDecimal(input.discountAmount ?? '0');
  const total = subtotal.plus(tax).minus(discount);

  return db.transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(tx, workspaceId);

    const [invoice] = await tx
      .insert(invoices)
      .values({
        workspaceId,
        clientId: input.clientId,
        invoiceNumber,
        currency: input.currency,
        subtotal: toDbString(subtotal),
        taxAmount: toDbString(tax),
        discountAmount: toDbString(discount),
        total: toDbString(total),
        dueDate: input.dueDate,
      })
      .returning();
    if (!invoice) throw new Error('Invoice insert returned no row');

    await tx.insert(invoiceItems).values(
      input.items.map((item, i) => ({
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: toDbString(lineAmounts[i]!),
      })),
    );

    await writeAuditEvent(tx, { event: 'INVOICE_CREATED', workspaceId, invoiceId: invoice.id });

    return invoice;
  });
}

export async function getInvoice(workspaceId: string, invoiceId: string) {
  return assertInvoiceInWorkspace(workspaceId, invoiceId);
}

/** Joins the client so list views can show a name without an N+1 fetch per
 * row. Still workspace-scoped on invoices, exactly as before. */
export async function listInvoices(workspaceId: string) {
  const rows = await db
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(eq(invoices.workspaceId, workspaceId))
    .orderBy(desc(invoices.createdAt));

  return rows.map((row) => ({ ...row.invoice, clientName: row.clientName }));
}

export async function updateInvoice(workspaceId: string, invoiceId: string, input: Partial<Pick<CreateInvoiceInput, 'currency' | 'dueDate'>>) {
  const invoice = await assertInvoiceInWorkspace(workspaceId, invoiceId);
  if (invoice.status !== 'DRAFT') {
    throw new ApiHttpError(409, 'invoice_not_draft', 'Only a draft invoice can be edited.');
  }
  const [updated] = await db.update(invoices).set(input).where(eq(invoices.id, invoiceId)).returning();
  await writeAuditEvent(db, { event: 'INVOICE_UPDATED', workspaceId, invoiceId, oldValue: invoice, newValue: input });
  return updated;
}

export async function deleteInvoice(workspaceId: string, invoiceId: string): Promise<void> {
  const invoice = await assertInvoiceInWorkspace(workspaceId, invoiceId);
  if (invoice.status !== 'DRAFT') {
    throw new ApiHttpError(409, 'invoice_not_draft', 'Only a draft invoice can be deleted.');
  }
  await db.delete(invoices).where(eq(invoices.id, invoiceId));
}

export async function sendInvoice(workspaceId: string, invoiceId: string) {
  const invoice = await assertInvoiceInWorkspace(workspaceId, invoiceId);
  const client = await db.query.clients.findFirst({ where: eq(clients.id, invoice.clientId) });
  if (!client) throw new ApiHttpError(404, 'client_not_found', 'Client not found.');

  return db.transaction(async (tx) => {
    await setInvoiceStatus(tx, invoiceId, invoice.status, 'SENT');
    await tx.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, invoiceId));
    await writeAuditEvent(tx, { event: 'INVOICE_SENT', workspaceId, invoiceId });

    const pdf = await generateInvoicePdf({ invoice, client });
    await sendEmail(client.email, `Invoice ${invoice.invoiceNumber}`, `Your invoice is ready. Total: ${invoice.currency} ${invoice.total}.`);
    void pdf; // PDF is generated for attachment/storage once real email delivery is wired — see identity-and-rbac/tasks.md-style follow-up note in lib/email.ts

    return { ...invoice, status: 'SENT' as InvoiceStatus, sentAt: new Date() };
  });
}

/** Manual (offline) payment — tagged source: MANUAL, recordedBy the acting user,
 * distinct from a webhook-confirmed payment (core-invoicing/design.md). */
export async function recordManualPayment(workspaceId: string, invoiceId: string, amount: string, recordedBy: string) {
  await assertInvoiceInWorkspace(workspaceId, invoiceId);

  const [payment] = await db.insert(payments).values({ invoiceId, amount, source: 'MANUAL', recordedBy }).returning();
  if (!payment) throw new Error('Payment insert returned no row');
  await generateReceiptForPayment(payment.id); // once, at confirmation time — see client-portal/design.md

  const newStatus = await recomputeStatusFromPayments(db, invoiceId);
  await invalidateCache(`workspace:${workspaceId}:invoice:${invoiceId}`);
  await invalidateCache(`workspace:${workspaceId}:dashboard`);
  await writeAuditEvent(db, { event: newStatus === 'PAID' ? 'INVOICE_MARKED_PAID' : 'PAYMENT_RECEIVED', workspaceId, invoiceId, userId: recordedBy, newValue: { amount, source: 'MANUAL' } });

  return newStatus;
}

/** PDF content only depends on line items/tax/discount/total/currency/client
 * details — none of which change once an invoice leaves DRAFT — so this is
 * cached long-term rather than regenerated on every download. */
export async function getInvoicePdf(workspaceId: string, invoiceId: string): Promise<Buffer> {
  const invoice = await assertInvoiceInWorkspace(workspaceId, invoiceId);
  if (invoice.status === 'DRAFT') {
    throw new ApiHttpError(409, 'invoice_not_sent', 'Send the invoice before downloading its PDF.');
  }
  const client = await db.query.clients.findFirst({ where: eq(clients.id, invoice.clientId) });
  if (!client) throw new ApiHttpError(404, 'client_not_found', 'Client not found.');

  const cacheKey = `workspace:${workspaceId}:invoice:${invoiceId}:pdf`;
  const base64Pdf = await cacheAside(cacheKey, PDF_CACHE_TTL_SECONDS, async () => {
    const pdf = await generateInvoicePdf({ invoice, client });
    return pdf.toString('base64');
  });
  return Buffer.from(base64Pdf, 'base64');
}

export async function cancelInvoice(workspaceId: string, invoiceId: string, actingUserId: string) {
  const invoice = await assertInvoiceInWorkspace(workspaceId, invoiceId);
  await setInvoiceStatus(db, invoiceId, invoice.status, 'CANCELLED'); // assertTransition rejects PARTIALLY_PAID/PAID sources
  await writeAuditEvent(db, { event: 'INVOICE_CANCELLED', workspaceId, invoiceId, userId: actingUserId });
}
