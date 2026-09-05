import { and, eq, isNull } from 'drizzle-orm';
import { db, clients, clientUsers } from '@invoice-saas/db';
import { checkPlanLimit } from '../subscriptions/check-plan-limit';
import { ApiHttpError } from '../../lib/errors';

export interface CreateClientInput {
  name: string;
  email: string;
  billingAddress?: string;
}

/**
 * Every client automatically gets portal access — there's no separate
 * "invite to portal" step (client-portal/requirements.md story 1 assumes an
 * invoice email always includes a portal link). `client_users.email` is
 * denormalized at creation time and deliberately NOT kept in sync with later
 * `clients.email` edits made by the workspace side — see
 * client-portal/design.md: an existing portal login shouldn't silently move
 * to a different inbox because the workspace corrected a contact email. The
 * client's own portal profile update is the one path allowed to change it.
 */
export async function createClient(workspaceId: string, input: CreateClientInput) {
  await checkPlanLimit(workspaceId, 'create_client');
  return db.transaction(async (tx) => {
    const [client] = await tx.insert(clients).values({ workspaceId, ...input }).returning();
    if (!client) throw new Error('Client insert returned no row');
    await tx.insert(clientUsers).values({ clientId: client.id, email: input.email });
    return client;
  });
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
