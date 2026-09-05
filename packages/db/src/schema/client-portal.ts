import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clients } from './invoicing';

export const clientUsers = pgTable(
  'client_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' })
      .unique(),
    // Denormalized from clients.email at creation time — deliberately not a live join.
    // See client-portal/design.md: an existing portal login shouldn't silently
    // move to a different inbox because the workspace edited the contact email.
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('client_users_email_idx').on(t.email)],
);

export const magicLinkTokens = pgTable('magic_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  // createdAt + 15 minutes — see client-portal/design.md
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const portalSessions = pgTable(
  'portal_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    // createdAt + 30 days — no rotation, see client-portal/design.md for why
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('portal_sessions_email_idx').on(t.email)],
);
