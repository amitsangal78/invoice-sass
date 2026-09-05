# Tasks — Client Portal

Depends on `identity-and-rbac` and `core-invoicing` schemas/services existing already.

## 1. Schema & migration
- [ ] `packages/db/schema/client-portal.ts` — `clientUsers`, `magicLinkTokens`, `portalSessions`.
- [ ] Migration adding `payments.receiptNumber` / `payments.receiptUrl` columns (extends `core-invoicing`'s `payments` table — additive migration per `rules/backend-api.md`, don't edit the original migration).

## 2. Portal auth service (`services/portal-auth/`) — depends on 1, `identity-and-rbac`'s token utilities (task 2 there)
- [ ] `requestLink()` — no account-enumeration, Redis rate limit 5/email/hour.
- [ ] `verifyLink()` — issues `portalSessions` row + session token.
- [ ] `logout()` — revokes the session.
- [ ] `authenticatePortalSession` middleware, `resolveClientContext` middleware — kept in their own file, never imported alongside the tenant `authenticate`/`resolveWorkspace` middleware.

## 3. Receipt generation (`services/invoicing/receipts.ts`) — depends on `core-invoicing` tasks 6–7 (payment recording)
- [ ] Generate receipt PDF at the same transaction point where a `payments` row is inserted (both the manual-payment path and the webhook path in `core-invoicing` now call this) — set `receiptNumber`/`receiptUrl` on that row.
- [ ] Test: receipt generated exactly once per payment, URL stable across repeated fetches.

## 4. Portal routes (`routes/portal/`) — depends on 2, 3
- [ ] `GET /portal/businesses`, `GET /portal/:clientId/invoices`, `GET /portal/:clientId/invoices/:invoiceId`, `POST /portal/:clientId/invoices/:invoiceId/pay` (delegates to `core-invoicing`'s payment-link creation service — no duplicate implementation), `GET /portal/:clientId/payments`, `PATCH /portal/:clientId/profile`.
- [ ] Every route composed with `authenticatePortalSession, resolveClientContext` — never the tenant middleware.

## 5. Email templates — depends on nothing above
- [ ] Magic-link email, updated invoice email (both payment-link and portal-link included per requirements story 1).

## 6. Tests
- [ ] Magic link expired/used/not-found rejection; valid-link happy path.
- [ ] Multi-workspace email isolation (two `client_users` rows, no cross-contamination).
- [ ] Cross-client isolation: client A's session requesting client B's `invoiceId` → 403.
- [ ] Receipt stability test (task 3).

## Explicit non-tasks here
Frontend portal UI — separate work once this API exists.
