# Tasks — Identity, Workspaces & RBAC

Implementation order matters — schema drives the feature (`saas-architecture-conventions`): each task lists what it depends on. Every task with a ☐ produces code + a colocated test per `rules/testing.md`; nothing here ships without the test in the same task.

## 1. Schema & migration (`packages/db`)
- [ ] Write `packages/db/schema/identity.ts` — `users`, `refreshTokens`, `emailVerificationTokens`, `passwordResetTokens`, `workspaces`, `workspaceMembers`, `workspaceInvitations` per `design.md`'s Drizzle shapes, including the enums and the `(userId, workspaceId)` unique constraint.
- [ ] Generate the migration (`drizzle-kit generate`), review the SQL by hand before applying — first migration in the repo, worth reading closely.
- [ ] Apply against the local Dockerized dev/test Postgres.

## 2. Shared token/password utilities (`apps/api/src/lib/auth/`)
- [ ] `hashPassword()` / `verifyPassword()` — Argon2.
- [ ] `generateSecureToken()` — returns `{ raw, hash }` (raw sent to the user, SHA-256 hash persisted); shared by refresh tokens, email-verification tokens, reset tokens, and invitation tokens so there's one implementation to audit, not four.
- [ ] `signAccessToken(userId, platformRole)` / `verifyAccessToken(token)` — 15 min expiry, minimal claims per `design.md`.

## 3. Auth service (`apps/api/src/services/auth/`) — depends on 1, 2
- [ ] `signup()` — validation → uniqueness check → hash → create `users` + `workspaces` + `workspace_members` (ADMIN) in one transaction → verification token → send email.
- [ ] `login()` — generic-401 on bad email/password (never reveal which), `isActive` check, issues access+refresh, writes `LOGIN_SUCCESS`/`LOGIN_FAILED` audit rows, Redis-backed rate limit on failures.
- [ ] `refresh()` — rotation + reuse-detection (a revoked hash presented again revokes every refresh token for that user). This is the task with the dedicated test called out in `design.md` — write it alongside.
- [ ] `logout()` / `logoutAll()`.
- [ ] `verifyEmail()`.
- [ ] `forgotPassword()` / `resetPassword()` — reset revokes all refresh tokens; no account-enumeration on `forgotPassword`.

## 4. Workspace & membership service (`apps/api/src/services/workspaces/`) — depends on 1
- [ ] `changeRole()` — rejects if target is `ownerId`; invalidates the Redis permissions cache key on success.
- [ ] `removeMember()` — rejects if target is `ownerId`; invalidates cache; revokes the removed member's refresh tokens.
- [ ] `transferOwnership()` + `confirmTransfer()` — two-step, per `design.md`.
- [ ] `listMembers()`.

## 5. Invitation service (`apps/api/src/services/invitations/`) — depends on 1, 2, 3
- [ ] `createInvitation()` — 7-day expiry, ADMIN-only (enforced by the route middleware, not re-checked here, but the service assumes it's already been checked).
- [ ] `acceptInvitation()` — both branches (existing user linked vs. new user created); rejects on non-`PENDING` or expired status.
- [ ] `resendInvitation()` / `revokeInvitation()`.
- [ ] Scheduled job `expireStaleInvitations()` — daily, flips past-due `PENDING` rows to `EXPIRED`. Wire into whatever the project's first scheduled-job mechanism ends up being (BullMQ repeatable job).

## 6. Middleware (`apps/api/src/middleware/`) — depends on 2, 4
- [ ] `authenticate` — verifies the access token, sets `req.user`.
- [ ] `resolveWorkspace` — Redis-cached `workspace:{workspaceId}:permissions:{userId}` (TTL 5–15 min per `tech.md`) read, Postgres fallback on miss; also rejects if `workspace.isSuspended`.
- [ ] `requireRole(...roles)`, `requireOwner`, `requirePlatformRole(...roles)`.
- [ ] `withAdminAuditLog()` helper per `design.md`'s admin-audit-on-view section.

## 7. Routes (`apps/api/src/routes/`) — depends on 3, 4, 5, 6
- [ ] `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/verify-email`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- [ ] `GET /workspaces/:id/members`, `PATCH /workspaces/:id/members/:userId`, `DELETE /workspaces/:id/members/:userId`, `POST /workspaces/:id/transfer-ownership`, `POST /workspaces/:id/transfer-ownership/confirm`.
- [ ] `POST /workspaces/:id/invitations`, `POST /workspaces/:id/invitations/:invId/resend`, `DELETE /workspaces/:id/invitations/:invId`, `POST /invitations/:token/accept`.
- [ ] `GET /admin/workspaces` — minimal platform-role-gated example route proving `requirePlatformRole` end-to-end; the admin console's full feature set is out of scope here (see `requirements.md`'s exclusions) and gets its own spec later.
- [ ] Zod request/response schemas for all of the above in `packages/types`, imported by both the routes and (later) the frontend forms — not redefined per app.

## 8. Redis integration — depends on 6
- [ ] Permissions-cache get/set/invalidate helper (wraps the raw Redis calls so call sites don't hand-roll key strings).
- [ ] Rate limiter middleware applied to `/auth/login`, `/auth/signup`, `/auth/forgot-password`, `/invitations/:token/accept`.

## 9. Email templates (`packages/email-templates/`) — depends on nothing above, can proceed in parallel
- [ ] Verification email, password-reset email, invitation email — plain, on-brand per `design-system.md`, each with one clear CTA link.

## 10. Tests — one per service task above, plus the cross-cutting ones called out in `design.md`
- [ ] Refresh rotation + reuse-detection.
- [ ] RBAC denial: MEMBER on an ADMIN-only route, non-owner ADMIN on an owner-only action, cross-workspace resource access.
- [ ] Invitation accept: existing-user-linked branch, new-user-created branch, reject-on-already-`ACCEPTED`/`EXPIRED`/`REVOKED`.
- [ ] Password reset revokes all refresh tokens (a previously issued one fails afterward).
- [ ] Signup → verify → login happy path (integration test spanning services 3).

## Explicit non-tasks here
Frontend UI (workspace switcher, team management screens, login/signup forms) is not in this spec's tasks — those belong to `apps/web`'s implementation once this API exists, tracked separately when that work starts.
