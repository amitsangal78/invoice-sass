import { db, clients, invoices, type InvoiceStatus } from '@invoice-saas/db';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';

export async function createTestWorkspace(email: string, workspaceName = 'Test Workspace') {
  const { userId, workspaceId } = await signup(db, { email, password: 'correct-horse-1', workspaceName });
  const { accessToken } = await login(db, { email, password: 'correct-horse-1' });
  return { userId, workspaceId, accessToken };
}

export async function createTestClient(workspaceId: string, overrides: Partial<{ name: string; email: string }> = {}) {
  const [client] = await db
    .insert(clients)
    .values({ workspaceId, name: overrides.name ?? 'Acme Ltd', email: overrides.email ?? 'acme@example.com' })
    .returning();
  if (!client) throw new Error('Failed to create test client');
  return client;
}

let invoiceCounter = 0;

/** Bypasses createInvoice() for tests that need direct control over total/status
 * without exercising the full creation flow (that flow has its own tests). */
export async function createTestInvoice(
  workspaceId: string,
  clientId: string,
  overrides: Partial<{ total: string; status: InvoiceStatus; currency: string; dueDate: string }> = {},
) {
  invoiceCounter += 1;
  const [invoice] = await db
    .insert(invoices)
    .values({
      workspaceId,
      clientId,
      invoiceNumber: `TEST-${invoiceCounter}`,
      currency: overrides.currency ?? 'INR',
      subtotal: overrides.total ?? '1000.00',
      total: overrides.total ?? '1000.00',
      dueDate: overrides.dueDate ?? new Date().toISOString().slice(0, 10),
      status: overrides.status ?? 'SENT',
    })
    .returning();
  if (!invoice) throw new Error('Failed to create test invoice');
  return invoice;
}
