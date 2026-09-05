import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, workspaceMembers } from '@invoice-saas/db';
import { createApp } from '../app';
import { createTestWorkspace, createTestClient } from '../test/fixtures';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';

const app = createApp();

async function addMemberTo(workspaceId: string, email: string) {
  const { userId } = await signup(db, { email, password: 'correct-horse-1', workspaceName: 'Member Own WS' });
  const { accessToken } = await login(db, { email, password: 'correct-horse-1' });
  await db.insert(workspaceMembers).values({ userId, workspaceId, role: 'MEMBER' });
  return { userId, accessToken };
}

// clients/invoices routes aren't nested under /workspaces/:id/..., so
// resolveWorkspace reads the active workspace from this header instead
// (resolve-workspace.ts) — every request below must carry it, exactly as a
// real frontend would once a workspace is selected.
const wsHeader = (workspaceId: string) => ['x-workspace-id', workspaceId] as [string, string];

describe('RBAC denial — clients & invoices (MEMBER-restricted actions)', () => {
  it('should reject a MEMBER deleting (archiving) a client — ADMIN only', async () => {
    const admin = await createTestWorkspace('admin-client@example.com');
    const client = await createTestClient(admin.workspaceId);
    const member = await addMemberTo(admin.workspaceId, 'member-client@example.com');

    const res = await request(app)
      .delete(`/api/v1/clients/${client.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('insufficient_role');
  });

  it('should allow a MEMBER to create a client', async () => {
    const admin = await createTestWorkspace('admin-create@example.com');
    const member = await addMemberTo(admin.workspaceId, 'member-create@example.com');

    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId))
      .send({ name: 'New Client', email: 'newclient@example.com' });

    expect(res.status).toBe(201);
  });

  it('should reject a MEMBER deleting a draft invoice — ADMIN only', async () => {
    const admin = await createTestWorkspace('admin-invdelete@example.com');
    const client = await createTestClient(admin.workspaceId);
    const member = await addMemberTo(admin.workspaceId, 'member-invdelete@example.com');

    const createRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId))
      .send({ clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '10.00' }] });
    expect(createRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/v1/invoices/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId));

    expect(deleteRes.status).toBe(403);
  });

  it('should reject a MEMBER cancelling an invoice — ADMIN only', async () => {
    const admin = await createTestWorkspace('admin-invcancel@example.com');
    const client = await createTestClient(admin.workspaceId);
    const member = await addMemberTo(admin.workspaceId, 'member-invcancel@example.com');

    const createRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set(...wsHeader(admin.workspaceId))
      .send({ clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '10.00' }] });
    expect(createRes.status).toBe(201);

    const cancelRes = await request(app)
      .post(`/api/v1/invoices/${createRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId));

    expect(cancelRes.status).toBe(403);
  });

  it('should allow a MEMBER to send an invoice and record a manual payment', async () => {
    const admin = await createTestWorkspace('admin-invsend@example.com');
    const client = await createTestClient(admin.workspaceId);
    const member = await addMemberTo(admin.workspaceId, 'member-invsend@example.com');

    const createRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId))
      .send({ clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '100.00' }] });
    expect(createRes.status).toBe(201);

    const sendRes = await request(app)
      .post(`/api/v1/invoices/${createRes.body.data.id}/send`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId));
    expect(sendRes.status).toBe(200);

    const payRes = await request(app)
      .post(`/api/v1/invoices/${createRes.body.data.id}/mark-paid`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .set(...wsHeader(admin.workspaceId))
      .send({ amount: '100.00' });
    expect(payRes.status).toBe(200);
    expect(payRes.body.data.status).toBe('PAID');
  });
});
