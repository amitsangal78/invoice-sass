/* eslint-disable no-console -- CLI script: printing the seeded credentials to the terminal is the entire point of it. */
/**
 * Seeds one demo account per role for local development, so every app
 * (web, admin, mobile) has ready-made logins right after a fresh DB setup.
 * Idempotent — safe to re-run; existing rows are updated in place rather
 * than duplicated.
 *
 * Usage: DATABASE_URL=... npx tsx src/scripts/seed-demo.ts
 */
import { eq, and } from 'drizzle-orm';
import {
  db,
  closeDb,
  users,
  workspaces,
  workspaceMembers,
  subscriptions,
  reminderRules,
  clients,
  clientUsers,
  magicLinkTokens,
} from '@invoice-saas/db';
import { hashPassword } from '../lib/auth/password';
import { generateSecureToken } from '../lib/auth/tokens';

const DEMO_PASSWORD = 'DemoPass123!';
const DEMO_REMINDER_OFFSETS = [-3, 0, 3, 10];

async function upsertPlatformUser(email: string, platformRole: 'SUPER_ADMIN' | 'SUPPORT_ADMIN') {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    await db.update(users).set({ platformRole, passwordHash, isVerified: true, isActive: true }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, passwordHash, platformRole, isVerified: true, isActive: true });
  }
  console.log(`  ${platformRole.padEnd(13)} ${email} / ${DEMO_PASSWORD}`);
}

async function upsertWorkspaceUser(email: string, role: 'ADMIN' | 'MEMBER', workspaceName: string) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let user = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, passwordHash, platformRole: 'NORMAL_USER', isVerified: true, isActive: true })
      .returning();
  } else {
    await db.update(users).set({ passwordHash, isVerified: true, isActive: true }).where(eq(users.id, user.id));
  }
  if (!user) throw new Error(`Failed to upsert user ${email}`);

  let workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, workspaceName) });
  if (!workspace) {
    [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning();
    if (!workspace) throw new Error(`Failed to create workspace ${workspaceName}`);

    await db.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'FREE', status: 'ACTIVE' });
    await db
      .insert(reminderRules)
      .values(DEMO_REMINDER_OFFSETS.map((offsetDays) => ({ workspaceId: workspace!.id, offsetDays })));
  }

  const existingMembership = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.workspaceId, workspace.id)),
  });
  if (existingMembership) {
    await db.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, existingMembership.id));
  } else {
    await db.insert(workspaceMembers).values({ userId: user.id, workspaceId: workspace.id, role });
  }

  console.log(`  ${role.padEnd(13)} ${email} / ${DEMO_PASSWORD}  (workspace: ${workspaceName})`);
  return workspace;
}

async function upsertPortalClient(email: string, workspaceId: string) {
  let client = await db.query.clients.findFirst({ where: and(eq(clients.workspaceId, workspaceId), eq(clients.email, email)) });
  if (!client) {
    [client] = await db.insert(clients).values({ workspaceId, name: 'Demo Client', email }).returning();
  }
  if (!client) throw new Error('Failed to create demo client');

  const existingClientUser = await db.query.clientUsers.findFirst({ where: eq(clientUsers.clientId, client.id) });
  if (!existingClientUser) {
    await db.insert(clientUsers).values({ clientId: client.id, email });
  }

  // Client portal is passwordless (magic-link only) — generate a live link
  // directly instead of relying on the console-log email stub, so the demo
  // account can be used right away.
  const token = generateSecureToken();
  await db.insert(magicLinkTokens).values({
    email,
    tokenHash: token.hash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  console.log(`  USER (portal)  ${email}  — no password, magic link (valid 15 min):`);
  console.log(`                 http://localhost:3000/portal/verify?token=${token.raw}`);
}

async function main() {
  console.log('Seeding demo accounts (password for all except the portal client below):\n');

  await upsertPlatformUser('superadmin@billify.dev', 'SUPER_ADMIN');
  await upsertPlatformUser('supportadmin@billify.dev', 'SUPPORT_ADMIN');

  const workspace = await upsertWorkspaceUser('admin@billify.dev', 'ADMIN', 'Demo Workspace');
  await upsertWorkspaceUser('member@billify.dev', 'MEMBER', 'Demo Workspace');

  await upsertPortalClient('client@billify.dev', workspace.id);

  console.log('\nDone. Re-run this script any time to get a fresh portal magic link.');
  await closeDb();
}

main().catch((err) => {
  console.error('seed-demo failed:', err);
  process.exit(1);
});
