import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, workspaceMembers } from '@invoice-saas/db';
import { createApp } from '../app';
import { createTestWorkspace } from '../test/fixtures';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';

const app = createApp();

async function addAdminMemberTo(workspaceId: string, email: string) {
  const { userId } = await signup(db, { email, password: 'correct-horse-1', workspaceName: 'Co-admin own WS' });
  const { accessToken } = await login(db, { email, password: 'correct-horse-1' });
  await db.insert(workspaceMembers).values({ userId, workspaceId, role: 'ADMIN' });
  return { userId, accessToken };
}

describe('billing routes — owner-only enforcement', () => {
  it('should reject a non-owner ADMIN calling /billing/checkout', async () => {
    const owner = await createTestWorkspace('billingowner1@example.com');
    const coAdmin = await addAdminMemberTo(owner.workspaceId, 'coadmin-billing1@example.com');

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${coAdmin.accessToken}`)
      .set('x-workspace-id', owner.workspaceId)
      .send({ plan: 'PRO' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_only');
  });

  it('should reject a non-owner ADMIN calling /billing/cancel', async () => {
    const owner = await createTestWorkspace('billingowner2@example.com');
    const coAdmin = await addAdminMemberTo(owner.workspaceId, 'coadmin-billing2@example.com');

    const res = await request(app)
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${coAdmin.accessToken}`)
      .set('x-workspace-id', owner.workspaceId);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_only');
  });

  it('should allow any workspace member (not just the owner) to read /billing/plan', async () => {
    const owner = await createTestWorkspace('billingowner3@example.com');
    const coAdmin = await addAdminMemberTo(owner.workspaceId, 'coadmin-billing3@example.com');

    const res = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${coAdmin.accessToken}`)
      .set('x-workspace-id', owner.workspaceId);

    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('FREE');
  });

  it('should allow the actual owner to call /billing/checkout (and surface the documented not-implemented boundary, not a false success)', async () => {
    const owner = await createTestWorkspace('billingowner4@example.com');

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('x-workspace-id', owner.workspaceId)
      .send({ plan: 'PRO' });

    // Owner passes the RBAC check; the 501 here is the documented
    // "requires live credentials" boundary, not an authorization failure.
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('not_implemented');
  });
});
