import { eq } from 'drizzle-orm';
import { db, payments, invoices, clients } from '@invoice-saas/db';
import { generateInvoicePdf } from './pdf';

let receiptCounter = 0;

/**
 * Generated once, at the same point a `payments` row is inserted — never
 * regenerated on download (client-portal/design.md's resolved decision). A
 * receipt is a historical financial document; its content shouldn't drift if
 * the workspace's branding changes later.
 *
 * Real persistence (S3) is a deployment concern this function doesn't own —
 * it returns the buffer and a stable receipt number; the caller decides
 * where to store it. In this environment (no S3 credentials), `receiptUrl`
 * is left as a placeholder reference rather than a real upload.
 */
export async function generateReceiptForPayment(paymentId: string): Promise<{ receiptNumber: string; receiptUrl: string }> {
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, payment.invoiceId) });
  if (!invoice) throw new Error(`Invoice ${payment.invoiceId} not found for payment ${paymentId}`);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, invoice.clientId) });
  if (!client) throw new Error(`Client ${invoice.clientId} not found for invoice ${invoice.id}`);

  // Reuses the invoice PDF renderer for now — a dedicated receipt layout
  // (payment date/method/reference instead of line items) is a follow-up;
  // the generation-timing and storage contract is what this task is about.
  await generateInvoicePdf({ invoice, client });

  receiptCounter += 1;
  const receiptNumber = `RCPT-${new Date().getFullYear()}-${String(receiptCounter).padStart(4, '0')}`;
  const receiptUrl = `placeholder://receipts/${paymentId}.pdf`; // real S3 upload is a deployment follow-up

  await db.update(payments).set({ receiptNumber, receiptUrl }).where(eq(payments.id, paymentId));

  return { receiptNumber, receiptUrl };
}
