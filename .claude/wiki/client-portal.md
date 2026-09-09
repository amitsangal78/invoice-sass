# Client Portal

## Purpose

A read-mostly portal for a workspace's own clients — the `USER` principal, distinct from both platform and workspace roles (see [identity-and-rbac.md](identity-and-rbac.md)). A client authenticates by magic link, never a password.

## Auth flow — deliberately simpler than the tenant side

One long-lived (30-day) `portal_sessions` token per email, no access/refresh rotation pair — justified by the portal's lower risk profile (read-mostly, no team/billing/destructive actions); matching the tenant side's short-access/rotating-refresh complexity here would be over-engineering for what this surface does.

```
POST /portal/request-link { email } → always 200 (no enumeration), 15-min magic_link_tokens row, 5/email/hour rate limit
GET  /portal/verify?token=...        → mark used, look up ALL client_users for that email, issue portal_sessions cookie
POST /portal/logout                  → revoke the portal_sessions row
```

**Magic link is email-scoped, not workspace-scoped**: verifying it authenticates the email, which may resolve to `client_users` rows in multiple workspaces (the same person is a client of several businesses). The portal shows a business switcher when more than one match exists — same UX pattern as the tenant app's workspace switcher, not a separate invention.

## Isolation (the one thing this domain cannot get wrong)

**Separate middleware chain, never mixed with the tenant `authenticate`/`resolveWorkspace`**:
```
authenticatePortalSession → resolveClientContext(clientId)
```
`resolveClientContext` re-verifies `client_users WHERE email = req.portalEmail AND clientId = :clientId` on **every single request** — never cached as "already authorized this session." A valid session for client A's `clientId` requesting client B's `invoiceId` must 403, even if both happen to belong to the same authenticated email in a test setup — this is tested explicitly (`portal.test.ts`) because it's the one bug class this domain can't afford.

## Key files

- Schema: `packages/db/src/schema/client-portal.ts` — `clientUsers`, `magicLinkTokens`, `portalSessions`. `clientUsers.email` is **denormalized** from `clients.email` at creation time, deliberately: if a client's contact email changes workspace-side, an existing portal login shouldn't silently break or redirect mid-session.
- Middleware: `apps/api/src/middleware/portal/{authenticate-portal-session,resolve-client-context}.ts`.
- Services: `apps/api/src/services/portal-auth/{portal-auth,portal-invoices}.ts`.
- Routes: `apps/api/src/routes/{portal,portal-auth}.ts`.
- Receipts: generated **once, at payment-confirmation time** (not on-demand) — a receipt is a historical financial document, its content shouldn't change if the workspace's branding changes later. `payments.receiptNumber`/`receiptUrl` set then; `receiptUrl` stable across repeated downloads.

## Consumed by

Nothing yet — see Known gaps.

## Known gaps

- **The client-portal frontend isn't built.** The full backend (auth, business switcher data, invoice list/detail, payment-link creation, receipts, profile update) exists and is tested; there's no UI consuming it.
- **`GET /invoices/:id/pdf` isn't extended to the `USER` principal** — `core-invoicing/design.md` scopes it to `ADMIN, MEMBER, and USER (own invoice only)`, but the implementation (see [core-invoicing.md](core-invoicing.md)) only covers the tenant side so far.
