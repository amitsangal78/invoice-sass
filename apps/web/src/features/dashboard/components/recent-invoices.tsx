import Link from 'next/link';
import type { Invoice } from '@/features/invoices/api/invoices';
import { InvoiceStatusBadge } from '@/shared/components/invoice-status-badge';
import { formatCurrency } from '@/lib/invoicing/status';

export function RecentInvoices({ invoices }: { invoices: (Invoice & { clientName?: string })[] }) {
  return (
    <div className="flex min-w-0 flex-col rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-text-primary">Recent Invoices</h2>
        <Link href="/invoices" className="text-[13px] font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {invoices.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-text-muted">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-5 py-2.5 font-medium">Invoice</th>
                <th className="px-5 py-2.5 font-medium">Client</th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-5 py-3">
                    <Link href={`/invoices/${invoice.id}`} className="font-semibold text-text-primary hover:text-primary">
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="max-w-[200px] truncate px-5 py-3 text-text-secondary">{invoice.clientName ?? '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-text-primary tabular-nums">
                    {formatCurrency(invoice.total, invoice.currency)}
                  </td>
                  <td className="px-5 py-3">
                    <InvoiceStatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
