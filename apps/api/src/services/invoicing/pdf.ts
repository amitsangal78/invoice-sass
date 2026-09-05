import PDFDocument from 'pdfkit';
import type { Client, Invoice, InvoiceItem } from '@invoice-saas/db';
import { db, invoiceItems as invoiceItemsTable } from '@invoice-saas/db';
import { eq } from 'drizzle-orm';

export interface GenerateInvoicePdfInput {
  invoice: Invoice;
  client: Client;
}

/**
 * Renders the invoice PDF in-memory (business/client details, line items,
 * totals, currency — core-invoicing/design.md). Returns a Buffer; where it's
 * persisted (S3) is a deployment concern, not this function's — callers
 * decide whether to store it.
 */
export async function generateInvoicePdf({ invoice, client }: GenerateInvoicePdfInput): Promise<Buffer> {
  const items: InvoiceItem[] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoice.id));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(`Invoice ${invoice.invoiceNumber}`, { align: 'left' });
    doc.moveDown();
    doc.fontSize(11).text(`Bill to: ${client.name}`);
    doc.text(client.email);
    if (client.billingAddress) doc.text(client.billingAddress);
    doc.moveDown();
    doc.text(`Issue date: ${invoice.createdAt.toDateString()}`);
    doc.text(`Due date: ${invoice.dueDate}`);
    doc.moveDown();

    doc.fontSize(12).text('Description', 50, doc.y, { continued: true, width: 250 });
    doc.text('Qty', 300, doc.y, { continued: true, width: 60 });
    doc.text('Unit Price', 360, doc.y, { continued: true, width: 90 });
    doc.text('Amount', 450, doc.y);
    doc.moveDown(0.5);

    for (const item of items) {
      doc.fontSize(10).text(item.description, 50, doc.y, { continued: true, width: 250 });
      doc.text(item.quantity, 300, doc.y, { continued: true, width: 60 });
      doc.text(item.unitPrice, 360, doc.y, { continued: true, width: 90 });
      doc.text(item.amount, 450, doc.y);
    }

    doc.moveDown();
    doc.fontSize(11).text(`Subtotal: ${invoice.currency} ${invoice.subtotal}`, { align: 'right' });
    doc.text(`Tax: ${invoice.currency} ${invoice.taxAmount}`, { align: 'right' });
    doc.text(`Discount: ${invoice.currency} ${invoice.discountAmount}`, { align: 'right' });
    doc.fontSize(13).text(`Total: ${invoice.currency} ${invoice.total}`, { align: 'right' });

    doc.end();
  });
}
