'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch, getWorkspaceId, ApiClientError } from '@/lib/api/server-client';
import type { InvoiceStatus } from '@/lib/invoicing/status';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  dueDate: string;
  sentAt: string | null;
  /** Present on list responses (joined server-side); absent on single-invoice reads. */
  clientName?: string;
}

export async function listInvoices(): Promise<Invoice[]> {
  return apiFetch<Invoice[]>('/invoices', { workspaceId: await getWorkspaceId() });
}

export async function getInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}`, { workspaceId: await getWorkspaceId() });
}

export interface InvoiceFormState {
  error?: string;
}

export async function createInvoiceAction(_prevState: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const clientId = String(formData.get('clientId') ?? '');
  const currency = String(formData.get('currency') ?? 'INR');
  const dueDate = String(formData.get('dueDate') ?? '');
  const itemsJson = String(formData.get('items') ?? '[]');

  let items: unknown;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { error: 'Invalid line items.' };
  }

  let invoice: Invoice;
  try {
    invoice = await apiFetch<Invoice>('/invoices', { method: 'POST', workspaceId: await getWorkspaceId(), body: { clientId, currency, dueDate, items } });
  } catch (err) {
    if (err instanceof ApiClientError) return { error: err.message };
    return { error: 'Something went wrong.' };
  }

  revalidatePath('/invoices');
  redirect(`/invoices/${invoice.id}`);
}

export async function sendInvoiceAction(invoiceId: string): Promise<void> {
  await apiFetch(`/invoices/${invoiceId}/send`, { method: 'POST', workspaceId: await getWorkspaceId() });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}

/** Bound with invoiceId via `.bind(null, invoiceId)` when used as a form
 * action — the form still supplies `amount` through FormData as usual. */
export async function markPaidAction(invoiceId: string, _prevState: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const amount = String(formData.get('amount') ?? '');
  try {
    await apiFetch(`/invoices/${invoiceId}/mark-paid`, { method: 'POST', workspaceId: await getWorkspaceId(), body: { amount } });
  } catch (err) {
    if (err instanceof ApiClientError) return { error: err.message };
    return { error: 'Something went wrong.' };
  }
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  return {};
}

export async function cancelInvoiceAction(invoiceId: string): Promise<void> {
  await apiFetch(`/invoices/${invoiceId}/cancel`, { method: 'POST', workspaceId: await getWorkspaceId() });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}
