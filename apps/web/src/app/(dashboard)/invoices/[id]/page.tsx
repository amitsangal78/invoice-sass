import { getInvoice, InvoiceActions } from '@/features/invoices';
import { InvoiceStatusBadge } from '@/shared/components/invoice-status-badge';
import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/invoicing/status';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-text-primary">{invoice.invoiceNumber}</h1>
        <InvoiceStatusBadge status={invoice.status} />
        {invoice.status !== 'DRAFT' ? (
          <a href={`/api/invoices/${invoice.id}/pdf`} className="ml-auto text-sm font-medium text-primary hover:underline">
            Download PDF
          </a>
        ) : null}
      </div>

      <Card className="max-w-md">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary">{formatCurrency(invoice.subtotal, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Tax</span>
            <span className="text-text-primary">{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Discount</span>
            <span className="text-text-primary">{formatCurrency(invoice.discountAmount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <span className="text-text-primary">Total</span>
            <span className="text-text-primary">{formatCurrency(invoice.total, invoice.currency)}</span>
          </div>
          <div className="mt-2 flex justify-between text-text-secondary">
            <span>Due date</span>
            <span>{invoice.dueDate}</span>
          </div>
        </div>
      </Card>

      <InvoiceActions invoiceId={invoice.id} status={invoice.status} />
    </div>
  );
}
