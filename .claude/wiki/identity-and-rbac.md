# Identity & RBAC

## Purpose

Everyone's front door: signup/login, workspace membership, and the two role systems everything else is gated by. Every other domain's routes compose this domain's middleware — nothing re-implements auth.

## The two role systems (don't conflate them)

- **Platform role** (`users.platformRole`): `SUPER_ADMIN` | `SUPPORT_ADMIN` | `NORMAL_USER`. Cross-tenant, checked by `requirePlatformRole(...)`. Only `apps/admin` routes use this. `NORMAL_USER` is the default for every tenant user — it says nothing about their role *within* any workspace.
- **Workspace role** (`workspace_members.role`): `ADMIN` | `MEMBER`, scoped to one `(userId, workspaceId)` pair via the unique constraint on that table. Checked by `requireRole(...)`. A user can be `ADMIN` in one workspace and `MEMBER` in another — this is why role is **never** embedded in the JWT (see below).
- **Client-portal principal** (`client_users`): not a role in either system above — a separate identity, authenticated by magic link, scoped to one `clientId`. See [client-portal.md](client-portal.md).

## Auth flow

- Access token: JWT, `{ sub: userId, platformRole }` only, 15 min, `HS256`. Workspace/role is deliberately absent — resolved fresh from `workspace_members` on every request (`resolveWorkspace` middleware, Redis-cached at `workspace:{workspaceId}:permissions:{userId}`, TTL 5–15 min) so a role change or removal takes effect immediately, not at the next token refresh.
- Refresh token: opaque random value, SHA-256 hash stored in `refresh_tokens`, 30 days, **rotated on every use**. Reuse-detection: a *revoked* token hash presented again nukes every refresh token for that user (stolen-token signal) — see `apps/api/src/services/auth/refresh.ts`, tested in `refresh.test.ts`.
- Password reset revokes **all** refresh tokens for the user (force re-login everywhere) — `password-reset.test.ts` asserts a previously-issued refresh token fails after reset.

## Middleware pipeline (`apps/api/src/middleware/`)

```
authenticate → resolveWorkspace → requireRole(...roles)
```
- `authenticate`: verifies JWT, sets `req.user = { id, platformRole }`.
- `resolveWorkspace`: reads workspace id from a route param **or** the `x-workspace-id` header (most routes aren't nested under `/workspaces/:id/...`, so tests/clients must send this header explicitly — an easy thing to forget, see [mistakes.md](mistakes.md)), looks up membership, sets `req.membership = { role, workspaceId }`, 403s if not a member or if `workspaces.isSuspended`.
- `requireRole(...roles)`: 403 if `req.membership.role` isn't in the list.
- `requireOwner`: 403 unless `req.user.id === workspaces.ownerId` — distinct from `requireRole('ADMIN')`, used for billing/ownership-transfer actions.
- `requirePlatformRole(...roles)`: for `apps/admin` routes, no workspace involved.
- **Resource-ownership** (e.g. `invoice.workspaceId === req.membership.workspaceId`) is checked *inside* each service, not in shared middleware — it's resource-specific, so it lives next to the query that fetches the resource (`rules/backend-api.md`).

## Key files

- Schema: `packages/db/src/schema/identity.ts` — `users`, `refreshTokens`, `emailVerificationTokens`, `passwordResetTokens`, `workspaces`, `workspaceMembers`, `workspaceInvitations`.
- Services: `apps/api/src/services/auth/{signup,login,refresh,logout,verify-email,password-reset}.ts`. `signup()` does more than create a user — see [core-invoicing.md](core-invoicing.md) and [subscription-billing.md](subscription-billing.md) for the extra responsibilities bolted on there.
- Middleware: `apps/api/src/middleware/{authenticate,resolve-workspace,require-role,rate-limit}.ts`.
- Routes: `apps/api/src/routes/{auth,workspaces,invitations}.ts`, `apps/api/src/routes/admin.ts` (platform-role routes).
- Admin bootstrap: `apps/api/src/scripts/{seed-admin,seed-demo}.ts` — there is no signup endpoint for `SUPER_ADMIN`/`SUPPORT_ADMIN` by design.
- Jobs: `apps/api/src/jobs/expire-stale-invitations.ts` (daily) — flips unaccepted, past-`expiresAt` `workspace_invitations` to `EXPIRED`; a job, never inferred lazily at read time, same pattern as `core-invoicing`'s `OVERDUE` transition.

## Invariants

- Never embed workspace role in the JWT (see above — this is the whole reason `resolveWorkspace` exists).
- Login always returns a generic "invalid credentials" on both unknown-email and wrong-password — never reveal which.
- Password-reset/forgot-password always 200s regardless of whether the email exists (no account enumeration) — same pattern the client-portal magic link reuses.
- `PATCH`/`DELETE` on `workspace_members` reject if the target is `workspaces.ownerId` — ownership isn't a side effect of a role patch or removal.

## Consumed by

`apps/web` (login/signup/workspace picker), `apps/mobile` (same), `apps/admin` (platform-role login only — never issues a workspace-scoped session).

## Known gaps

Active-sessions UI (list/revoke individual `refresh_tokens` rows) — the data model (`deviceLabel`) anticipates it but no route/UI exists yet.
