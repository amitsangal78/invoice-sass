# Tasks — Client Portal

Depends on `identity-and-rbac` and `core-invoicing` schemas/services existing already.

**Status: implemented and passing (81/81 tests overall, TypeScript strict, ESLint clean).**

## 1. Schema & migration
- [x] `clientUsers`, `magicLinkTokens`, `portalSessions` (already part of the initial migration).
- [x] `payments.receiptNumber`/`payments.receiptUrl` columns (already part of the initial `core-invoicing` schema, since all four specs' schemas were written together).

## 2. Portal auth service (`services/portal-auth/portal-auth.ts`)
- [x] `requestMagicLink()` — no account enumeration, rate-limited (5/email+IP/hour).
- [x] `verifyMagicLink()` — issues a `portalSessions` row + opaque session token.
- [x] `logoutPortalSession()`.
- [x] `authenticatePortalSession`, `resolveClientContext` middleware (`middleware/portal/`) — kept in their own files, never imported alongside the tenant `authenticate`/`resolveWorkspace`. A tenant access token is verified not to work as a portal session (tested explicitly).

## 3. Receipt generation (`services/invoicing/receipts.ts`)
- [x] `generateReceiptForPayment()` — called from both `core-invoicing`'s manual-payment path and its webhook path, at the same transaction point the `payments` row is inserted.
- [x] Tested: identical `receiptUrl` across repeated portal fetches (not regenerated per request).
- **Deviation**: receipt storage uses a `placeholder://` URL rather than a real S3 upload (no S3 credentials in this environment) — the generation-timing and stable-reference contract is fully implemented and tested; wiring the actual upload is a deployment follow-up. The receipt PDF currently reuses the invoice PDF layout rather than a dedicated receipt template.

## 4. Portal routes (`routes/portal-auth.ts`, `routes/portal.ts`)
- [x] `POST /portal-auth/request-link`, `POST /portal-auth/verify`, `POST /portal-auth/logout`.
- [x] `GET /portal/businesses`, `GET /portal/:clientId/invoices`, `GET /portal/:clientId/invoices/:invoiceId`, `POST /portal/:clientId/invoices/:invoiceId/pay` (delegates to the same `createRazorpayOrder()` boundary `core-invoicing` uses — no duplicate payment-link logic), `GET /portal/:clientId/payments`, `PATCH /portal/:clientId/profile`.
- [x] Every route composed with `authenticatePortalSession`/`resolveClientContext` — never the tenant middleware.
- **Added beyond the original plan**: `createClient()` (in `core-invoicing`) now auto-provisions a `client_users` row for every new client, so a client can request a magic link without a separate portal-signup step — the spec's requirements assumed this ("an invoice email always includes a portal link") but the design doc hadn't stated exactly when the row gets created. Also decided: a client's own profile update is the one path allowed to change `client_users.email` (kept out of sync with workspace-side `clients.email` edits, per the design's stated reasoning).

## 5. Email templates
- [ ] **Gap, consistent with the rest of the codebase**: magic-link email and the invoice email's portal-link addition both go through the same `lib/email.ts` console-log stub as every other email in this project. No real content/SES wiring yet.

## 6. Tests
- [x] Magic link: expired/used/not-found rejection; valid-link happy path.
- [x] Multi-workspace email isolation (two `client_users` rows for one email, both listed, kept separate).
- [x] Cross-client isolation, at the HTTP layer: client A's session requesting client B's invoice → 403 `not_your_business`, even within the same workspace.
- [x] A tenant access token rejected as a portal session (cross-principal-type test, not in the original plan but worth having given how easy this mistake would be to make).
- [x] Receipt stability.

## Explicit non-tasks here (unchanged)
Frontend portal UI — separate work once this API exists.
