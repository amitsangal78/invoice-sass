import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { InvoiceStatusBadge } from '@/shared/components/invoice-status-badge';
import { formatCurrency } from '@/lib/invoicing/status';
import type { Invoice } from '../api/invoices';
import type { Client } from '@/features/clients';

export function InvoiceTable({ invoices, clientsById }: { invoices: Invoice[]; clientsById: Map<string, Client> }) {
  if (invoices.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-secondary">No invoices yet.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Invoice</th>
            <th className="px-5 py-3">Client</th>
            <th className="px-5 py-3">Amount</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="border-b border-border last:border-0 hover:bg-background">
              <td className="px-5 py-3">
                <Link href={`/invoices/${invoice.id}`} className="font-semibold text-text-primary hover:text-primary">
                  {invoice.invoiceNumber}
                </Link>
              </td>
              <td className="px-5 py-3 text-text-secondary">{clientsById.get(invoice.clientId)?.name ?? '—'}</td>
              <td className="px-5 py-3 font-semibold text-text-primary">{formatCurrency(invoice.total, invoice.currency)}</td>
              <td className="px-5 py-3">
                <InvoiceStatusBadge status={invoice.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
