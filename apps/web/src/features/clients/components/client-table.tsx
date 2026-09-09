import { Card } from '@/components/ui/card';
import type { Client } from '../api/clients';

export function ClientTable({ clients }: { clients: Client[] }) {
  if (clients.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-secondary">No clients yet — add your first one above.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Email</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id} className="border-b border-border last:border-0">
              <td className="px-5 py-3 font-semibold text-text-primary">{client.name}</td>
              <td className="px-5 py-3 text-text-secondary">{client.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
