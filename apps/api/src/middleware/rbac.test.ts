import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, workspaceMembers } from '@invoice-saas/db';
import { createApp } from '../app';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';

const app = createApp();

async function signupAndLogin(email: string, workspaceName: string) {
  const { workspaceId } = await signup(db, { email, password: 'correct-horse-1', workspaceName });
  const { accessToken, user } = await login(db, { email, password: 'correct-horse-1' });
  return { accessToken, userId: user.id, workspaceId };
}

describe('RBAC denial cases', () => {
  it('should reject a MEMBER calling an ADMIN-only route (change role)', async () => {
    const admin = await signupAndLogin('admin1@example.com', 'Workspace A');

    // Arrange a MEMBER directly — the invitation flow is covered by its own tests.
    const member = await signupAndLogin('member1@example.com', 'Member Own Workspace');
    await db.insert(workspaceMembers).values({ userId: member.userId, workspaceId: admin.workspaceId, role: 'MEMBER' });

    const res = await request(app)
      .patch(`/api/v1/workspaces/${admin.workspaceId}/members/${admin.userId}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ role: 'MEMBER' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('insufficient_role');
  });

  it('should reject a non-owner ADMIN calling an owner-only route (transfer ownership)', async () => {
    const owner = await signupAndLogin('owner1@example.com', 'Workspace B');

    const coAdmin = await signupAndLogin('coadmin1@example.com', 'Co-Admin Own Workspace');
    await db.insert(workspaceMembers).values({ userId: coAdmin.userId, workspaceId: owner.workspaceId, role: 'ADMIN' });

    const res = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/transfer-ownership`)
      .set('Authorization', `Bearer ${coAdmin.accessToken}`)
      .send({ newOwnerUserId: owner.userId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_only');
  });

  it('should reject cross-workspace access even for a valid member of a different workspace', async () => {
    const workspaceA = await signupAndLogin('userA@example.com', 'Workspace A2');
    const workspaceB = await signupAndLogin('userB@example.com', 'Workspace B2');

    // userA is a real ADMIN of workspace A — but has no membership in workspace B at all.
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceB.workspaceId}/members`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_a_member');
  });

  it('should allow an ADMIN to list members of their own workspace', async () => {
    const admin = await signupAndLogin('admin2@example.com', 'Workspace C');

    const res = await request(app)
      .get(`/api/v1/workspaces/${admin.workspaceId}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('should reject requests with no access token at all', async () => {
    const admin = await signupAndLogin('noauth@example.com', 'Workspace D');
    const res = await request(app).get(`/api/v1/workspaces/${admin.workspaceId}/members`);
    expect(res.status).toBe(401);
  });
});
