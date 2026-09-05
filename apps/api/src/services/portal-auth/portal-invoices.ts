import { eq } from 'drizzle-orm';
import { db, invoices, payments, clients, clientUsers } from '@invoice-saas/db';
import { createRazorpayOrder } from '../payments/providers/razorpay';
import { ApiHttpError } from '../../lib/errors';

// Every function here takes clientId already verified by resolveClientContext
// — no route in this file re-derives workspace/role authorization; the
// isolation check happened in middleware (client-portal/design.md).

export async function listInvoicesForClient(clientId: string) {
  return db.select().from(invoices).where(eq(invoices.clientId, clientId));
}

export async function getInvoiceForClient(clientId: string, invoiceId: string) {
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!invoice || invoice.clientId !== clientId) {
    throw new ApiHttpError(404, 'invoice_not_found', 'Invoice not found.');
  }
  return invoice;
}

export async function listPaymentsForClient(clientId: string) {
  const clientInvoices = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, clientId));
  const invoiceIds = new Set(clientInvoices.map((i) => i.id));
  if (invoiceIds.size === 0) return [];

  const allPayments = await db.select().from(payments);
  return allPayments.filter((p) => invoiceIds.has(p.invoiceId));
}

/** Delegates to the SAME payment-link creation core-invoicing would use for
 * a tenant-initiated send — the portal is another entry point to the same
 * flow, not a separate payment path (client-portal/requirements.md story 3). */
export async function initiatePortalPayment(clientId: string, invoiceId: string) {
  const invoice = await getInvoiceForClient(clientId, invoiceId);
  return createRazorpayOrder(invoice.total, invoice.currency, invoice.id);
}

export interface UpdatePortalProfileInput {
  name?: string;
  email?: string;
  billingAddress?: string;
}

/** The one path allowed to change client_users.email — a conscious action by
 * the client themselves, unlike a workspace-side edit (see createClient()'s
 * comment on why those stay out of sync deliberately). */
export async function updatePortalProfile(clientId: string, input: UpdatePortalProfileInput) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(clients).set(input).where(eq(clients.id, clientId)).returning();
    if (!updated) throw new ApiHttpError(404, 'client_not_found', 'Client not found.');
    if (input.email) {
      await tx.update(clientUsers).set({ email: input.email }).where(eq(clientUsers.clientId, clientId));
    }
    return updated;
  });
}
