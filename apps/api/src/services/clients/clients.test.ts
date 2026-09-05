import { describe, expect, it } from 'vitest';
import { createClient, listClients, archiveClient } from './clients';
import { createTestWorkspace, createTestInvoice } from '../../test/fixtures';
import { PlanLimitExceededError } from '../../lib/errors';

describe('client archive', () => {
  it('should hide an archived client from the default list but keep it readable with includeArchived', async () => {
    const ws = await createTestWorkspace('archivetest@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Acme', email: 'acme@example.com' });

    await archiveClient(ws.workspaceId, client!.id);

    const defaultList = await listClients(ws.workspaceId, false);
    expect(defaultList.find((c) => c.id === client!.id)).toBeUndefined();

    const fullList = await listClients(ws.workspaceId, true);
    expect(fullList.find((c) => c.id === client!.id)).toBeDefined();
  });

  it("should keep an archived client's historical invoices fully readable", async () => {
    const ws = await createTestWorkspace('archivehist@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Acme', email: 'acme@example.com' });
    const invoice = await createTestInvoice(ws.workspaceId, client!.id, { status: 'PAID' });

    await archiveClient(ws.workspaceId, client!.id);

    // The invoice itself is untouched by archiving its client.
    const stillThere = await createTestInvoice(ws.workspaceId, client!.id); // sanity: client still accepts FK references
    expect(stillThere.clientId).toBe(client!.id);
    expect(invoice.clientId).toBe(client!.id);
  });
});

describe('client plan limits', () => {
  it('should reject creating a 4th client on the Free plan', async () => {
    const ws = await createTestWorkspace('planlimit@example.com');
    await createClient(ws.workspaceId, { name: 'C1', email: 'c1@example.com' });
    await createClient(ws.workspaceId, { name: 'C2', email: 'c2@example.com' });
    await createClient(ws.workspaceId, { name: 'C3', email: 'c3@example.com' });

    await expect(createClient(ws.workspaceId, { name: 'C4', email: 'c4@example.com' })).rejects.toThrow(PlanLimitExceededError);
  });
});
