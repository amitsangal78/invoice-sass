# Tasks — Identity, Workspaces & RBAC

Implementation order matters — schema drives the feature (`saas-architecture-conventions`): each task lists what it depends on. Every task with a ☐ produces code + a colocated test per `rules/testing.md`; nothing here ships without the test in the same task.

**Status: mostly implemented, passing tests (24/24 for this spec's own suite, part of 67/67 overall).** Checked off below; a few gaps are called out honestly rather than marked done.

## 1. Schema & migration (`packages/db`)
- [x] `packages/db/schema/identity.ts` — `users`, `refreshTokens`, `emailVerificationTokens`, `passwordResetTokens`, `workspaces`, `workspaceMembers`, `workspaceInvitations`, plus `ownershipTransfers` (added during implementation — the two-step ownership-transfer flow needed a table the original design sketch hadn't named).
- [x] Migration generated, reviewed, and applied to the local Dockerized Postgres.

## 2. Shared token/password utilities (`apps/api/src/lib/auth/`)
- [x] `hashPassword()`/`verifyPassword()` — Argon2id.
- [x] `generateSecureToken()` — shared by refresh, verification, reset, and invitation tokens.
- [x] `signAccessToken()`/`verifyAccessToken()` — 15 min expiry, `{ sub, platformRole }` only.

## 3. Auth service (`apps/api/src/services/auth/`)
- [x] `signup()`, `login()`, `refresh()` (rotation + reuse-detection, tested explicitly), `logout()`/`logoutAll()`, `verifyEmail()`, `forgotPassword()`/`resetPassword()`.
- **Note**: `signup()` also seeds a workspace's `subscriptions` (FREE/ACTIVE) row and default `reminderRules` — responsibilities added by `core-invoicing`'s and `subscription-billing`'s designs, documented there rather than duplicated here.

## 4. Workspace & membership service (`apps/api/src/services/workspaces/`)
- [x] `changeRole()`, `removeMember()` (both reject on the owner, invalidate the permissions cache), `initiateOwnershipTransfer()`/`confirmOwnershipTransfer()`, `listMembers()`.

## 5. Invitation service (`apps/api/src/services/invitations/`)
- [x] `createInvitation()` (7-day expiry), `acceptInvitation()` (both branches tested), `resendInvitation()`/`revokeInvitation()`.
- [ ] **Gap**: `expireStaleInvitations()` scheduled job was not written in this pass — unaccepted invitations past `expiresAt` stay `PENDING` in the database rather than auto-flipping to `EXPIRED` (the `acceptInvitation()` check still correctly rejects them by comparing `expiresAt` directly, so this is a data-hygiene gap, not a security one).

## 6. Middleware (`apps/api/src/middleware/`)
- [x] `authenticate`, `resolveWorkspace` (Redis-cached, 10 min TTL, Postgres fallback, suspension check), `requireRole`/`requireOwner`/`requirePlatformRole`, `withAdminAuditLog()`.

## 7. Routes (`apps/api/src/routes/`)
- [x] All auth routes, all workspace/member/ownership-transfer routes, all invitation routes, and `GET /admin/workspaces` proving `requirePlatformRole` end-to-end.
- [x] Zod schemas in `packages/types/src/auth.ts` and `workspaces.ts`.

## 8. Redis integration
- [x] Permissions-cache helper (`cacheAside`/`invalidateCache` in `lib/redis.ts`), used by `resolveWorkspace` and (later) `subscription-billing`'s plan cache.
- [x] Rate limiting (`middleware/rate-limit.ts`) — Redis fixed-window, fails open on Redis unavailability, keyed by IP+email where a body has one. Applied to `/auth/signup` (5/hr), `/auth/login` (10/15min), `/auth/forgot-password` (5/hr), `/invitations/:token/accept` (10/hr), and (from `core-invoicing`) both payment webhook endpoints (200/min, IP-only).

## 9. Email templates
- [ ] **Gap**: `lib/email.ts` remains a `console.log` stub for every email this spec sends (verification, password reset, invitation). No real SES integration or `packages/email-templates` content exists yet — every service call site is already wired to `sendEmail()`, so swapping the implementation is a one-file change, not a refactor.

## 10. Tests
- [x] Refresh rotation + reuse-detection.
- [x] RBAC denial (MEMBER on ADMIN-only, non-owner ADMIN on owner-only, cross-workspace access) — extended further in `core-invoicing`'s own RBAC test file.
- [x] Invitation accept, both branches, plus reject-on-non-PENDING.
- [x] Password reset revokes all refresh tokens.
- [x] Signup → verify → login happy path.

## Explicit non-tasks here (unchanged)
Frontend UI is separate work once this API exists.
