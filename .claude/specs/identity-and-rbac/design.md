# Design — Identity, Workspaces & RBAC

> Builds on the approved `requirements.md`. The four open acceptance-criteria
> items are resolved below (defaults chosen, not re-asked) — see "Resolved
> decisions." Everything here is buildable in `tasks.md` next.

## Resolved decisions

| Open item | Decision | Why |
|---|---|---|
| Workspace-switching UX | Topbar dropdown (web) / switcher screen (mobile) listing every workspace the user belongs to. Auto-select the only workspace on single-membership login; otherwise default to the last-used workspace (persisted per user), not a forced prompt every login. | Matches the mockup's "Amit Consulting ▾" pattern; avoids friction for the common single-workspace case while still supporting multi-workspace users. |
| Invitation expiry window | **7 days** | Common convention (GitHub, Slack use similar windows); short enough to keep `workspace_invitations` from accumulating stale rows, long enough for a real person to see an email. |
| Access token lifetime | **15 minutes** | As proposed in requirements — short enough that a stolen access token has a small blast radius. |
| Refresh token lifetime | **30 days**, rotated on every use | Favors UX for freelancers/small teams who don't want to re-login often; rotation means a stolen *unused* refresh token stops working the moment the legitimate user's client refreshes. |
| Admin-audit-on-view | **In scope now** | Consistent with the project's "no phases, build everything now" decision — `invoice_events`-style audit infrastructure already exists from day one, so gating this one story behind "later" would be an inconsistent carve-out. |

## Data model (Drizzle schema shape)

```ts
// packages/db/schema/identity.ts

export const platformRoleEnum = pgEnum('platform_role', ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'NORMAL_USER']);
export const workspaceRoleEnum = pgEnum('workspace_role', ['ADMIN', 'MEMBER']);
export const invitationStatusEnum = pgEnum('invitation_status', ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),        // null only for a USER-only account created via client_users, never for ADMIN/MEMBER
  platformRole: platformRoleEnum('platform_role').notNull().default('NORMAL_USER'),
  isVerified: boolean('is_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),      // SHA-256 of the raw token; raw token never stored
  deviceLabel: text('device_label'),            // e.g. parsed User-Agent, for the future "active sessions" list
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),           // set on logout / role removal / password reset; null = active
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('refresh_tokens_user_id_idx').on(t.userId),
}));

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  isSuspended: boolean('is_suspended').notNull().default(false),
  // business-profile fields land here in core-invoicing's design.md (billing address, tax id, logo, invoice-numbering config, default currency) — not duplicated here
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  role: workspaceRoleEnum('role').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueMembership: unique('workspace_members_user_workspace_unique').on(t.userId, t.workspaceId),
  workspaceIdx: index('workspace_members_workspace_id_idx').on(t.workspaceId),
}));

export const workspaceInvitations = pgTable('workspace_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: workspaceRoleEnum('role').notNull(),
  status: invitationStatusEnum('status').notNull().default('PENDING'),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),   // createdAt + 7 days
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('workspace_invitations_workspace_id_idx').on(t.workspaceId),
}));
```

`invoice_events`-equivalent audit rows for this spec's own events (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `MEMBER_INVITED`, `ROLE_CHANGED`, `WORKSPACE_UPDATED`, plus the new `TENANT_DATA_VIEWED` for admin-audit-on-view) reuse the `invoice_events` table shape defined in the domain skill — `workspace_id` nullable here since a platform-role login event isn't workspace-scoped.

## Auth flows

### Signup
```
POST /api/v1/auth/signup { email, password, workspaceName }
  → zod-validate
  → check email uniqueness (users.email)
  → hash password (Argon2)
  → INSERT users (platformRole: NORMAL_USER, isVerified: false)
  → INSERT workspaces (ownerId: new user)
  → INSERT workspace_members (role: ADMIN)
  → INSERT email_verification_tokens (raw token emailed, hash stored, expiresAt: +24h)
  → send verification email (SES)
  → 201 { user, workspace } — no session issued yet; policy choice below
```
**Policy**: login is allowed before verification (don't block a paying user from using the product), but a banner/limited-mode UI nudges verification — verification is required only for specific sensitive actions if that's later decided in `core-invoicing`'s design, not gated here.

### Login
```
POST /api/v1/auth/login { email, password }
  → find user by email → 401 generic "invalid credentials" if not found (never reveal which field was wrong)
  → verify password hash → 401 generic on mismatch
  → check isActive → 403 if suspended at the user level (distinct from workspace suspension)
  → issue access token: JWT { sub: user.id, platformRole }, exp 15m, signed with the access-token secret
  → issue refresh token: random 256-bit value; store SHA-256 hash in refresh_tokens, exp 30d
  → write LOGIN_SUCCESS audit row
  → 200 { accessToken, refreshToken, user }
```
Failed attempts: rate-limited via Redis (`tech.md` conventions) keyed on email+IP; write `LOGIN_FAILED` audit row on each failure for anomaly review.

### Refresh
```
POST /api/v1/auth/refresh { refreshToken }
  → hash the provided token, look up refresh_tokens by hash
  → reject if not found, revoked, or expired
  → issue a NEW access token + NEW refresh token (rotation)
  → mark the old refresh_tokens row revoked, insert the new one
  → 200 { accessToken, refreshToken }
```
Reuse-detection: if a *revoked* token hash is presented again, treat it as a stolen-token signal — revoke every refresh token for that user and force re-login everywhere (standard rotation-detection practice).

### Logout / logout-all
```
POST /api/v1/auth/logout { refreshToken }          → revoke that one row
POST /api/v1/auth/logout-all                        → revoke every row for req.user.id
```

### Email verification
```
GET /api/v1/auth/verify-email?token=...
  → hash token, look up email_verification_tokens
  → reject if not found, used, or expired
  → mark usedAt, set users.isVerified = true
```

### Password reset
```
POST /api/v1/auth/forgot-password { email }         → always 200 regardless of whether the email exists (no account enumeration)
  → if found: create password_reset_tokens (exp 1h), email it
POST /api/v1/auth/reset-password { token, newPassword }
  → hash token, look up, reject if not found/used/expired
  → update users.passwordHash
  → mark token used
  → revoke ALL refresh_tokens for that user (force re-login everywhere)
```

### Invitation lifecycle
```
POST /api/v1/workspaces/:id/invitations { email, role }      [ADMIN only]
  → INSERT workspace_invitations (status: PENDING, expiresAt: +7d)
  → email invite link containing the raw token (hash stored)

POST /api/v1/invitations/:token/accept { password? }
  → hash token, look up PENDING + unexpired workspace_invitations
  → if users row exists for that email: use it (this is the "link existing account" case)
  → else: create users row (platformRole: NORMAL_USER, isVerified: true — invitation acceptance via a working email link IS the verification)
    → password required in the request body for a newly-created user; ignored/rejected if the user already exists (they use their existing password)
  → INSERT workspace_members (role: invitation.role)
  → UPDATE workspace_invitations SET status = 'ACCEPTED'

POST /api/v1/workspaces/:id/invitations/:invId/resend    [ADMIN only] → new token+expiry, re-email
DELETE /api/v1/workspaces/:id/invitations/:invId          [ADMIN only] → status = 'REVOKED'
```
A scheduled job (daily) flips unaccepted, past-`expiresAt` invitations to `EXPIRED` — same pattern as the invoice `OVERDUE` transition in `core-invoicing`: a job, never a user action, never inferred lazily at read time only (so a workspace's invitation list is correct even before anyone looks at it).

### Role change / removal / ownership transfer
```
PATCH /api/v1/workspaces/:id/members/:userId { role }   [ADMIN only]
  → reject if :userId === workspaces.ownerId (ownership isn't a side effect of a role patch)
  → UPDATE workspace_members.role
  → invalidate Redis workspace:{id}:permissions:{userId}
  → write ROLE_CHANGED audit row

DELETE /api/v1/workspaces/:id/members/:userId            [ADMIN only]
  → reject if :userId === workspaces.ownerId
  → DELETE workspace_members row
  → invalidate Redis workspace:{id}:permissions:{userId}
  → revoke that user's refresh_tokens (defense in depth per requirements)

POST /api/v1/workspaces/:id/transfer-ownership { newOwnerUserId }   [current owner only]
  → newOwnerUserId must already be an ADMIN member
  → creates a pending transfer record (or a short-lived token), emailed/notified to the new owner
POST /api/v1/workspaces/:id/transfer-ownership/confirm { token }    [new owner only]
  → UPDATE workspaces.ownerId
```

## Authorization middleware pipeline (`apps/api/src/middleware/`)

```ts
authenticate        // verifies JWT signature+expiry, sets req.user = { id, platformRole }; 401 on failure
resolveWorkspace     // reads workspace id from route param/header, looks up workspace_members(req.user.id, workspaceId)
                     // — Redis-cached at workspace:{workspaceId}:permissions:{userId}, TTL 5–15 min, Postgres on miss
                     // sets req.membership = { role } or 403 if no row (not a member) or workspace.isSuspended
requireRole(...roles)   // 403 if req.membership.role not in roles
requireOwner            // 403 if req.user.id !== workspace.ownerId (separate from requireRole('ADMIN'))
requirePlatformRole(...roles)  // for admin-console routes; checks req.user.platformRole, no workspace involved
```

Route composition example:
```ts
router.patch('/workspaces/:id/members/:userId',
  authenticate, resolveWorkspace, requireRole('ADMIN'),
  membersController.changeRole);

router.get('/admin/workspaces',
  authenticate, requirePlatformRole('SUPER_ADMIN', 'SUPPORT_ADMIN'),
  adminController.listWorkspaces);
```

Resource-ownership check (step 4 in requirements' story 5) happens **inside** each controller/service, not in shared middleware — it's resource-specific (`invoice.workspace_id === req.membership.workspaceId`), so it belongs next to the query that fetches the resource, per `rules/backend-api.md`.

## Admin-audit-on-view

`requirePlatformRole` routes that read tenant financial data wrap the read in a helper that also writes the audit row:
```ts
withAdminAuditLog(req, { event: 'TENANT_DATA_VIEWED', workspaceId, detail: 'invoice list' }, () => invoicesService.listForWorkspace(workspaceId));
```
This keeps the audit write co-located with the read it's auditing, rather than relying on every controller remembering to call it separately.

## Testing requirements for this spec

- Refresh rotation + reuse-detection (a revoked token presented again revokes the whole session set) — this is the one bug class in this spec worth a dedicated test, same weight as the webhook redelivery test in `core-invoicing`.
- RBAC denial cases: MEMBER attempting an ADMIN-only route, a non-owner ADMIN attempting an owner-only action, cross-workspace access attempt (valid membership in workspace A, requesting a resource in workspace B).
- Invitation accept: both branches (existing user linked, new user created) — including the case where acceptance is attempted on an already-`ACCEPTED`/`EXPIRED`/`REVOKED` invitation (must reject, not silently re-activate).
- Password reset revokes all refresh tokens — verify a previously-issued refresh token fails after reset.
