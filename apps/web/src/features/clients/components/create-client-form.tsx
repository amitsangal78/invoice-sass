'use client';

import { useActionState } from 'react';
import { createClientAction } from '../api/clients';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CreateClientForm() {
  const [state, formAction, isPending] = useActionState(createClientAction, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="name">Client name</Label>
        <Input id="name" name="name" required className="w-56" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required className="w-56" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Adding…' : 'Add client'}
      </Button>
      {state.error ? <p className="w-full text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}
