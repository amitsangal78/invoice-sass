import { listClients, CreateClientForm, ClientTable } from '@/features/clients';

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-text-primary">Clients</h1>
      <CreateClientForm />
      <ClientTable clients={clients} />
    </div>
  );
}
