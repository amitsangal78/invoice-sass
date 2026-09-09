'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, getWorkspaceId, ApiClientError } from '@/lib/api/server-client';

export interface Client {
  id: string;
  name: string;
  email: string;
  billingAddress: string | null;
  archivedAt: string | null;
}

export async function listClients(): Promise<Client[]> {
  return apiFetch<Client[]>('/clients', { workspaceId: await getWorkspaceId() });
}

export interface CreateClientFormState {
  error?: string;
}

export async function createClientAction(_prevState: CreateClientFormState, formData: FormData): Promise<CreateClientFormState> {
  const name = String(formData.get('name') ?? '');
  const email = String(formData.get('email') ?? '');

  try {
    await apiFetch('/clients', { method: 'POST', workspaceId: await getWorkspaceId(), body: { name, email } });
  } catch (err) {
    if (err instanceof ApiClientError) return { error: err.message };
    return { error: 'Something went wrong.' };
  }

  revalidatePath('/clients');
  return {};
}
