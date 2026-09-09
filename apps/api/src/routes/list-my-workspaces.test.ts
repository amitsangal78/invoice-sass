import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, workspaceMembers } from '@invoice-saas/db';
import { createApp } from '../app';
import { createTestWorkspace } from '../test/fixtures';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';

const app = createApp();

describe('GET /workspaces/mine', () => {
  it("should list a single-workspace user's own workspace with role and ownership", async () => {
    const ws = await createTestWorkspace('mine1@example.com', 'My Business');

    const res = await request(app).get('/api/v1/workspaces/mine').set('Authorization', `Bearer ${ws.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ workspaceId: ws.workspaceId, name: 'My Business', role: 'ADMIN', isOwner: true });
  });

  it('should list every workspace a multi-workspace user belongs to, with correct per-workspace role', async () => {
    const wsA = await createTestWorkspace('mine-a@example.com', 'Workspace A');
    const { userId } = await signup(db, { email: 'multiws@example.com', password: 'correct-horse-1', workspaceName: 'Workspace B (own)' });
    const { accessToken } = await login(db, { email: 'multiws@example.com', password: 'correct-horse-1' });
    await db.insert(workspaceMembers).values({ userId, workspaceId: wsA.workspaceId, role: 'MEMBER' });

    const res = await request(app).get('/api/v1/workspaces/mine').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const asMember = res.body.data.find((w: { workspaceId: string }) => w.workspaceId === wsA.workspaceId);
    expect(asMember).toMatchObject({ role: 'MEMBER', isOwner: false });
  });

  it('should reject an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/workspaces/mine');
    expect(res.status).toBe(401);
  });
});
