import { CreateInvoiceForm } from '@/features/invoices';
import { listClients } from '@/features/clients';

export default async function NewInvoicePage() {
  const clients = await listClients();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-text-primary">New Invoice</h1>
      <CreateInvoiceForm clients={clients} />
    </div>
  );
}
