# Requirements — Identity, Workspaces & RBAC

> DRAFT — awaiting approval before design.md. This is the foundation spec —
> `core-invoicing`, `client-portal`, `subscription-billing`, and the admin
> console all depend on the model defined here. Get this one right first.

## Surfaces touched
Backend, Website (signup + team management), Admin console (platform-role
auth), Mobile (login only — team management stays web-only).

## User stories

### 1. Signup, self-built auth & workspace creation
- WHEN a new user signs up THEN the system SHALL validate the request,
  check email uniqueness, hash the password (Argon2 preferred, bcrypt
  acceptable — never plain storage), create the `users` row, create a
  `workspaces` row, create a `workspace_members` row linking that user to
  the new workspace with role `ADMIN`, set `workspaces.owner_id` to that
  user, generate an email-verification token, and email it.
- WHEN a user logs in with valid credentials THEN the system SHALL verify
  the password hash, check account status (active, verified per policy),
  issue a short-lived access token (`{ sub: userId, platformRole }` only —
  no workspace/role claims), issue a refresh token, and store the refresh
  token **hashed** in `refresh_tokens`.
- WHEN an access token expires THEN the frontend SHALL silently attempt a
  refresh via the refresh token before falling back to a re-login prompt
  — never leaving the user in a half-authenticated state.
- WHEN a user logs out THEN the system SHALL revoke that device's
  `refresh_tokens` row; a "logout all devices" action SHALL revoke every
  row for that user.
- WHEN a user clicks a valid, unexpired email-verification link THEN the
  system SHALL mark the token used (not just expired-checked) and mark
  the user verified.
- WHEN a user requests a password reset THEN the system SHALL generate a
  hashed, expiring, single-use token, email it, and — on successful reset
  — SHALL invalidate that token and SHOULD revoke existing refresh tokens
  (forcing re-login on other devices) as a security measure.
- WHEN any authenticated request resolves the caller's identity THEN the
  system SHALL do so from the access token's `sub` claim only — workspace
  and role are **never** embedded in the token; they're resolved fresh
  from `workspace_members` per request (see story 5), so a role change or
  removal takes effect immediately rather than at next token refresh.
- IF a user belongs to more than one workspace THEN the frontend SHALL
  require selecting/switching the active workspace, and every subsequent
  request SHALL carry that workspace context.

### 2. Team management
- WHEN an ADMIN invites a team member by email THEN the system SHALL
  create a `workspace_invitations` row (email, proposed role, status
  `PENDING`) and email an invite link. An ADMIN SHALL also be able to
  resend or revoke (status `REVOKED`) a pending invitation, and an
  unaccepted invitation SHALL expire (status `EXPIRED`) after a defined
  window. ⚠️ pick the expiry window before design.md.
- WHEN an invited user accepts THEN the system SHALL: if an account with
  that email already exists (e.g. they're a member of a different
  workspace), link the existing `users` row; otherwise create one
  (setting a password as part of acceptance, since `ADMIN`/`MEMBER` are
  password-based logins, unlike the client portal's `USER`). Either way,
  the system SHALL activate the matching `workspace_members` row with the
  invited role and set the invitation status to `ACCEPTED`.
- WHEN an ADMIN changes a member's role THEN the system SHALL update
  `workspace_members.role` — only ADMIN may do this, never a MEMBER
  (including for their own row).
- WHEN an ADMIN removes a member THEN the system SHALL revoke their
  workspace access immediately (existing sessions must fail workspace
  resolution on next request, not just future logins) — this SHOULD also
  revoke that member's `refresh_tokens` for defense in depth, though
  workspace-resolution failure alone is sufficient for correctness.
- IF the target of a role-change or removal is `workspaces.owner_id` THEN
  the system SHALL reject the action — ownership transfer is a separate,
  explicit flow (see story 3), not a side effect of a role change.

### 3. Ownership
- WHEN an ADMIN who is not the owner attempts to delete the workspace,
  cancel the subscription, or change billing THEN the system SHALL reject
  it — these three actions are owner-only, not merely ADMIN-only.
- WHEN the owner transfers ownership to another ADMIN THEN the system
  SHALL update `workspaces.owner_id` and SHALL require the new owner to
  confirm (not a single-sided action).

### 4. Platform roles (SUPER_ADMIN / SUPPORT_ADMIN)
- WHEN an internal staff account has `users.platform_role` set THEN the
  system SHALL authorize admin-console access based on that field alone —
  never via any `workspace_members` row (platform roles are not
  workspace-scoped).
- WHEN a `SUPPORT_ADMIN` views tenant data THEN the system SHALL restrict
  them to read-only support views (tenant status, metadata, failed
  webhook events) — not live invoice/payment editing.
- WHEN a `SUPER_ADMIN` or `SUPPORT_ADMIN` views any tenant's financial
  data THEN the system SHALL write an `invoice_events` (or equivalent
  admin-audit) row recording the access, since this is support-only,
  exceptional access, not routine.
- WHEN a `SUPER_ADMIN` suspends or reactivates a workspace THEN every
  workspace member's subsequent request SHALL be rejected (suspended) or
  restored (reactivated) accordingly.

### 5. Authorization on every request
- WHEN any workspace-scoped API request arrives THEN the system SHALL: (1)
  verify the access token's signature and expiry, (2) resolve
  `workspace_members` for `(user_id, workspace_id)` — cache-assisted per
  `tech.md`'s Redis conventions, Postgres authoritative on a cache miss,
  (3) check the resolved role has permission for the requested action per
  the RBAC table in the domain skill, (4) verify the target resource's
  `workspace_id` matches — in that order, rejecting at the first failed
  step.
- WHEN a request's workspace id is client-supplied (e.g. a header or route
  param) THEN the system SHALL treat it as a lookup key only, never as an
  authorization decision by itself — the membership check is what
  authorizes, not the presence of the id.

## Explicit exclusions from this spec
- Client/payer login — a different principal entirely, see `client-portal`.
- Subscription plan enforcement logic — see `subscription-billing`
  (this spec covers *who can act*, not *what their plan allows*).
- The admin console's actual feature set (tenant search UI, plan override
  UI) — this spec covers the authorization model it relies on, not its UI.

## Acceptance criteria for spec approval
- [x] Workspace-switching UX for multi-workspace users confirmed — see
      `design.md`'s "Resolved decisions" (topbar dropdown, auto-select on
      single membership, last-used default otherwise)
- [x] Invitation expiry window chosen — 7 days, see `design.md`
- [x] Access token lifetime (15 min) and refresh token lifetime (30 days,
      rotated on use) confirmed — see `design.md`
- [x] Admin-audit-on-view requirement confirmed in-scope now, not deferred
      — see `design.md`

Spec approved for design — proceeding to `tasks.md`.
