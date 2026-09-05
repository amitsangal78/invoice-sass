# Design — Client Portal

> Builds on `identity-and-rbac/design.md` (auth patterns to mirror) and
> `core-invoicing/design.md` (the invoice/payment data this surfaces).

## Resolved decisions

| Open item | Decision | Why |
|---|---|---|
| Multi-workspace client UX | Magic link is **email-scoped, not workspace-scoped** — verifying it authenticates the email, which may resolve to `client_users` rows in several workspaces. Portal shows a **business switcher** (same pattern as the tenant app's workspace switcher) when more than one match exists; each business's invoices render in their own scoped view, never merged into one list. Single match: skip the switcher, go straight in. | Reuses a pattern the user already has to learn once (tenant workspace switcher); avoids inventing a second UX for the same underlying idea. |
| Magic-link expiry/rate limit | **15-minute expiry, single-use.** Rate limit: 5 requests per email per hour (Redis-backed, same mechanism as login rate limiting). | A magic link is a login credential in transit (email) — short-lived like the tenant's access token flow is security-conscious; 5/hour stops abuse without blocking a legitimate user who mistypes/re-requests. |
| Receipt generation timing | **At payment-confirmation time**, not on-demand. A receipt PDF is generated and stored (S3) the moment a `payments` row is inserted (webhook or manual), with `payments.receiptUrl`/`receiptNumber` set then. | A receipt is a historical financial document — its content (business branding, terms) shouldn't silently change if the workspace's branding changes later. Generating once and storing matches the "computed totals stored, not derived" principle already used for invoices. |

## Data model (extends `packages/db/schema/invoicing.ts` and adds `client-portal.ts`)

```ts
// packages/db/schema/invoicing.ts — additions
export const payments = pgTable('payments', {
  // ...existing columns from core-invoicing/design.md...
  receiptNumber: text('receipt_number'),      // e.g. "RCPT-2026-0007", generated alongside the receipt
  receiptUrl: text('receipt_url'),            // S3 reference, set once at payment-confirmation time
});

// packages/db/schema/client-portal.ts
export const clientUsers = pgTable('client_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }).unique(),
  email: text('email').notNull(),           // denormalized from clients.email at creation time; see note below
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ emailIdx: index('client_users_email_idx').on(t.email) }));

export const magicLinkTokens = pgTable('magic_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),   // createdAt + 15 min
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const portalSessions = pgTable('portal_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),   // createdAt + 30 days
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ emailIdx: index('portal_sessions_email_idx').on(t.email) }));
```

`clientUsers.email` is denormalized (copied at creation) rather than joined live from `clients.email`, deliberately: if a client's contact email changes on the workspace side, an *existing* portal login shouldn't silently break or redirect to a different inbox mid-session — updating a client's login email is a conscious action (story 2's "update own contact info"), not a side effect of the workspace editing the contact.

**Session model, simpler than the tenant side on purpose**: one long-lived (30-day) session token per email, no access/refresh rotation pair. Justified by the portal's lower risk profile (read-mostly, no team/billing/destructive actions) — matching the tenant app's short-access/rotating-refresh complexity here would be over-engineering for what this surface does. `portal_sessions` gives logout/revocation without needing rotation.

## Auth flow

```
POST /portal/request-link { email }
  → always 200 (no account enumeration) — if client_users rows exist for
    this email, generate a magic_link_tokens row (15 min expiry), email it
  → rate-limited 5/email/hour via Redis

GET /portal/verify?token=...
  → hash token, look up magic_link_tokens: reject if not found/used/expired
  → mark usedAt
  → look up ALL client_users rows for that email (across workspaces)
  → issue a portal_sessions row + session token (30 days), set as httpOnly cookie
  → redirect to the portal (business switcher if >1 client_users match, else straight to that business's invoice list)

POST /portal/logout → revoke the portal_sessions row
```

## Portal API routes (`apps/api/src/routes/portal/`)

All routes below use a **separate middleware chain** from the tenant side — never mixed with `authenticate`/`resolveWorkspace` from `identity-and-rbac`:

```ts
authenticatePortalSession   // verifies the session cookie/token, sets req.portalEmail
resolveClientContext(clientId)  // looks up client_users WHERE email = req.portalEmail AND clientId = :clientId
                                 // 403 if no matching row — this is story 4's isolation check, on every request
```

| Route | Notes |
|---|---|
| `GET /portal/businesses` | list of `{ clientId, workspaceName }` for the authenticated email — powers the switcher |
| `GET /portal/:clientId/invoices` | outstanding / overdue / paid, scoped via `resolveClientContext` |
| `GET /portal/:clientId/invoices/:invoiceId` | full detail incl. line items; 403 if invoice's `clientId` doesn't match |
| `POST /portal/:clientId/invoices/:invoiceId/pay` | creates a payment-link session — **same service call as `core-invoicing`'s payment-link creation**, not a duplicate implementation |
| `GET /portal/:clientId/payments` | payment history + `receiptUrl` links |
| `PATCH /portal/:clientId/profile` | updates the `clients` row's contact fields — authorized by `resolveClientContext` only, no workspace-role check applies here (per requirements story 2) |

## Isolation enforcement (story 4)

Every route above takes `:clientId` as a route param and re-verifies it against `req.portalEmail` via `resolveClientContext` on **every** request — never cached as "already authorized this session." This mirrors the tenant side's rule (resource ownership checked per-request, not inferred from a prior check) but for the client principal instead of workspace membership.

## Testing requirements for this spec

- Magic link: expired/used/not-found all rejected; valid link authenticates and issues a session.
- Multi-workspace email: two `client_users` rows for one email → `/portal/businesses` returns both, each `/portal/:clientId/...` call scoped correctly, no cross-contamination.
- Isolation: a valid session for client A's `clientId` requesting client B's `invoiceId` → 403, even though both might belong to the same authenticated email in a contrived test setup (defense in depth — verify the check is per-`clientId`, not per-email-globally-trusted).
- Receipt: generated once at payment time, `receiptUrl` stable across repeated downloads (not regenerated per request).
