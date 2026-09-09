import Link from 'next/link';
import { listInvoices, InvoiceTable } from '@/features/invoices';
import { listClients } from '@/features/clients';
import { Button } from '@/components/ui/button';

export default async function InvoicesPage() {
  const [invoices, clients] = await Promise.all([listInvoices(), listClients()]);
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Invoices</h1>
        <Link href="/invoices/new">
          <Button>+ New Invoice</Button>
        </Link>
      </div>
      <InvoiceTable invoices={invoices} clientsById={clientsById} />
    </div>
  );
}
