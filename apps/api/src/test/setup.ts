import { afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '@invoice-saas/db';
import { closeRedis, getRedis } from '../lib/redis';

// Real Dockerized test Postgres — no mocked DB layer (rules/testing.md).
// TRUNCATE ... CASCADE between every test keeps each test's data isolated
// without paying for a fresh schema/migration per test.
const TABLES = [
  'invoice_events',
  'reminder_events',
  'reminder_rules',
  'webhook_events',
  'payments',
  'invoice_items',
  'invoices',
  'invoice_sequences',
  'clients',
  'subscription_webhook_events',
  'subscriptions',
  'portal_sessions',
  'magic_link_tokens',
  'client_users',
  'ownership_transfers',
  'workspace_invitations',
  'workspace_members',
  'workspaces',
  'password_reset_tokens',
  'email_verification_tokens',
  'refresh_tokens',
  'users',
];

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  await getRedis().flushdb();
});

afterAll(async () => {
  await closeDb();
  await closeRedis();
});
