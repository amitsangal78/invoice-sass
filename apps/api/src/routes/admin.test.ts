import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db, users, invoiceEvents } from '@invoice-saas/db';
import { createApp } from '../app';
import { createTestWorkspace } from '../test/fixtures';
import { hashPassword } from '../lib/auth/password';
import { login } from '../services/auth/login';

const app = createApp();

async function createPlatformStaff(email: string, role: 'SUPER_ADMIN' | 'SUPPORT_ADMIN') {
  const passwordHash = await hashPassword('correct-horse-1');
  await db.insert(users).values({ email, passwordHash, platformRole: role, isVerified: true });
  const { accessToken } = await login(db, { email, password: 'correct-horse-1' });
  return accessToken;
}

describe('admin workspace management', () => {
  it('should list all workspaces for a SUPER_ADMIN', async () => {
    await createTestWorkspace('adminlist1@example.com');
    const token = await createPlatformStaff('super1@platform.internal', 'SUPER_ADMIN');

    const res = await request(app).get('/api/v1/admin/workspaces').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject a NORMAL_USER (regular tenant user) from the admin routes entirely', async () => {
    const ws = await createTestWorkspace('adminreject1@example.com');
    const res = await request(app).get('/api/v1/admin/workspaces').set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow SUPER_ADMIN to suspend a workspace, immediately blocking that workspace (cache invalidated, not just TTL-expired)', async () => {
    const ws = await createTestWorkspace('adminsuspend1@example.com');
    const superAdmin = await createPlatformStaff('super2@platform.internal', 'SUPER_ADMIN');

    // Prime the permissions cache for this member by making one authorized call first.
    const before = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/members`).set('Authorization', `Bearer ${ws.accessToken}`).set('x-workspace-id', ws.workspaceId);
    expect(before.status).toBe(200);

    const suspendRes = await request(app).post(`/api/v1/admin/workspaces/${ws.workspaceId}/suspend`).set('Authorization', `Bearer ${superAdmin}`);
    expect(suspendRes.status).toBe(204);

    // Immediately after — no wait for cache TTL — the same member must now be rejected.
    const after = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/members`).set('Authorization', `Bearer ${ws.accessToken}`).set('x-workspace-id', ws.workspaceId);
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('workspace_suspended');
  });

  it('should allow SUPER_ADMIN to reactivate a suspended workspace', async () => {
    const ws = await createTestWorkspace('adminreactivate1@example.com');
    const superAdmin = await createPlatformStaff('super3@platform.internal', 'SUPER_ADMIN');

    await request(app).post(`/api/v1/admin/workspaces/${ws.workspaceId}/suspend`).set('Authorization', `Bearer ${superAdmin}`);
    await request(app).post(`/api/v1/admin/workspaces/${ws.workspaceId}/reactivate`).set('Authorization', `Bearer ${superAdmin}`);

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/members`).set('Authorization', `Bearer ${ws.accessToken}`).set('x-workspace-id', ws.workspaceId);
    expect(res.status).toBe(200);
  });

  it('should reject a SUPPORT_ADMIN attempting to suspend a workspace (read-only)', async () => {
    const ws = await createTestWorkspace('adminsupport1@example.com');
    const supportAdmin = await createPlatformStaff('support1@platform.internal', 'SUPPORT_ADMIN');

    const res = await request(app).post(`/api/v1/admin/workspaces/${ws.workspaceId}/suspend`).set('Authorization', `Bearer ${supportAdmin}`);
    expect(res.status).toBe(403);
  });

  it('should allow a SUPPORT_ADMIN to view workspace detail (support-only read access)', async () => {
    const ws = await createTestWorkspace('adminsupport2@example.com');
    const supportAdmin = await createPlatformStaff('support2@platform.internal', 'SUPPORT_ADMIN');

    const res = await request(app).get(`/api/v1/admin/workspaces/${ws.workspaceId}`).set('Authorization', `Bearer ${supportAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('FREE');
  });

  it('should write an audit event every time a workspace detail is viewed by platform staff', async () => {
    const ws = await createTestWorkspace('adminaudit1@example.com');
    const superAdmin = await createPlatformStaff('super4@platform.internal', 'SUPER_ADMIN');

    await request(app).get(`/api/v1/admin/workspaces/${ws.workspaceId}`).set('Authorization', `Bearer ${superAdmin}`);

    const events = await db.select().from(invoiceEvents).where(eq(invoiceEvents.workspaceId, ws.workspaceId));
    expect(events.some((e) => e.event === 'TENANT_DATA_VIEWED')).toBe(true);
  });
});
