import { and, eq, isNull } from 'drizzle-orm';
import { db, clients } from '@invoice-saas/db';
import { checkPlanLimit } from '../subscriptions/check-plan-limit';
import { ApiHttpError } from '../../lib/errors';

export interface CreateClientInput {
  name: string;
  email: string;
  billingAddress?: string;
}

export async function createClient(workspaceId: string, input: CreateClientInput) {
  await checkPlanLimit(workspaceId, 'create_client');
  const [client] = await db.insert(clients).values({ workspaceId, ...input }).returning();
  return client;
}

export async function listClients(workspaceId: string, includeArchived: boolean) {
  const condition = includeArchived ? eq(clients.workspaceId, workspaceId) : and(eq(clients.workspaceId, workspaceId), isNull(clients.archivedAt));
  return db.select().from(clients).where(condition);
}

export async function updateClient(workspaceId: string, clientId: string, input: Partial<CreateClientInput>) {
  const [updated] = await db
    .update(clients)
    .set(input)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .returning();
  if (!updated) throw new ApiHttpError(404, 'client_not_found', 'Client not found.');
  return updated;
}

/**
 * Always archive, never a real delete — core-invoicing/design.md's resolved
 * decision. A client with zero invoices today might reference a backdated
 * one later; a two-path "hard-delete if no invoices" rule would leave that
 * edge case broken.
 */
export async function archiveClient(workspaceId: string, clientId: string) {
  const [archived] = await db
    .update(clients)
    .set({ archivedAt: new Date() })
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .returning();
  if (!archived) throw new ApiHttpError(404, 'client_not_found', 'Client not found.');
  return archived;
}
