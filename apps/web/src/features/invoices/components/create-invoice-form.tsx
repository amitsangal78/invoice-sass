'use client';

import { useActionState, useState } from 'react';
import { createInvoiceAction } from '../api/invoices';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Client } from '@/features/clients';

interface LineItemRow {
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_ROW: LineItemRow = { description: '', quantity: '1', unitPrice: '0.00' };

export function CreateInvoiceForm({ clients }: { clients: Client[] }) {
  const [state, formAction, isPending] = useActionState(createInvoiceAction, {});
  const [items, setItems] = useState<LineItemRow[]>([{ ...EMPTY_ROW }]);

  function updateItem(index: number, field: keyof LineItemRow, value: string) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="clientId">Client</Label>
          <select id="clientId" name="clientId" required className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm">
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue="INR" maxLength={3} required />
        </div>
        <div>
          <Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" required />
        </div>
      </div>

      <div>
        <Label>Line items</Label>
        <div className="flex flex-col gap-2">
          {items.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Description" value={row.description} onChange={(e) => updateItem(i, 'description', e.target.value)} className="flex-1" />
              <Input placeholder="Qty" value={row.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} className="w-20" />
              <Input placeholder="Unit price" value={row.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', e.target.value)} className="w-32" />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setItems((prev) => [...prev, { ...EMPTY_ROW }])} className="mt-2 text-sm font-semibold text-primary">
          + Add item
        </button>
      </div>

      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? 'Creating…' : 'Create invoice'}
      </Button>
    </form>
  );
}
