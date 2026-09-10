# apps/api

Node 22 + Express REST API — the single backend behind `apps/web`, `apps/admin`, and `apps/mobile`. No client talks to the database directly; everything goes through this API.

## Stack

Express 4, Drizzle ORM over PostgreSQL, Redis (`ioredis`) for caching and rate-limiting, BullMQ for scheduled jobs (reminder emails, stale-invitation cleanup), self-built JWT auth (Argon2 password hashing, access + rotating refresh tokens with reuse detection — no Cognito/Auth0), Zod for request validation (schemas shared with the frontends via `packages/types`), `decimal.js` for all money math, `pdfkit` for invoice PDFs, `node:crypto` for Razorpay/Stripe webhook HMAC verification (no provider SDK dependency).

## Environment variables

Copy this into `apps/api/.env` (gitignored — never commit real secrets):

```bash
DATABASE_URL=postgres://user:password@localhost:5432/invoice_saas_dev
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=<32+ random bytes, e.g. `openssl rand -base64 32`>
JWT_REFRESH_PEPPER=<32+ random bytes, mixed into refresh-token hashing>
PORT=4000
RAZORPAY_WEBHOOK_SECRET=<from your Razorpay dashboard, once live>
STRIPE_WEBHOOK_SECRET=<from your Stripe dashboard, once live>
```

Validated on boot by `src/lib/env.ts` (`getEnv()`) — the process refuses to start with a missing/invalid value rather than falling back silently. `NODE_ENV` defaults to `development`; the two webhook secrets default to test placeholders if unset, but everything else is required.

If you have more than one Postgres instance on your machine (Docker, a system install, Homebrew, etc.), double-check `DATABASE_URL`'s port — this is the most common cause of "API runs but writes go nowhere I expect." (See `.claude/wiki/infrastructure.md` if this project's dev machine ended up with more than one Postgres install — it has, more than once.)

## Running

```bash
pnpm --filter @invoice-saas/db db:migrate   # apply schema (run once, and after any migration)
pnpm --filter @invoice-saas/api dev         # tsx watch src/index.ts, on $PORT (default 4000)
```

`.env` is loaded automatically via `dotenv/config` at the top of `src/index.ts`. Scripts under `src/scripts/` (see below) do **not** auto-load it — pass `DATABASE_URL=...` on the command line, or `set -a; source .env; set +a` first.

### Seeding accounts

There is deliberately no signup endpoint for platform staff (`SUPER_ADMIN`/`SUPPORT_ADMIN`) — self-service creation of that role would defeat its purpose. Two scripts cover every role:

```bash
pnpm --filter @invoice-saas/api seed:admin -- <email> <password> [SUPER_ADMIN|SUPPORT_ADMIN]
pnpm --filter @invoice-saas/api seed:demo   # one demo account per role at once — see root README for the list
```

`seed:demo` is idempotent (safe to re-run) and prints a fresh 15-minute client-portal magic link each time, since that role is passwordless by design.

## API surface

Routes live in `src/routes/`, thin by convention — parse/validate → call one `services/` function → shape the response as `{ data }` or `{ error: { code, message } }` (see `.claude/rules/backend-api.md`). Grouped roughly as:

- `auth.ts` — signup, login, refresh, logout, email verification, password reset
- `workspaces.ts`, `invitations.ts` — workspace CRUD, membership, invites
- `clients.ts`, `invoices.ts` — core invoicing, including `GET /invoices/:id/pdf` (Redis-cached for 15 days — safe because a sent invoice is immutable; only for non-`DRAFT` invoices)
- `billing.ts`, `subscription-webhooks.ts` — plan limits, subscription lifecycle (kept separate from `webhooks.ts` — the subscription path must never touch invoice/payment state)
- `webhooks.ts` — Razorpay/Stripe payment webhooks, signature-verified and idempotent
- `portal.ts`, `portal-auth.ts` — client-portal endpoints, fully separate auth middleware chain from tenant auth
- `admin.ts` — cross-tenant `SUPER_ADMIN`/`SUPPORT_ADMIN` endpoints (workspace suspend/reactivate, audit log), each write wrapped in `withAdminAuditLog`
- `dashboard.ts`, `events.ts` — dashboard aggregates, SSE stream

Business logic lives in `src/services/<domain>/`, not in routes — see `.claude/rules/backend-api.md` for why (routes are the only thing three different callers — a manual action, a webhook, a background job — would otherwise have to duplicate).

For a current-state map of how these domains relate (what depends on what, cross-domain gotchas), see `.claude/wiki/` and `.claude/graph/functionality-graph.md` — read the relevant page before a change that spans more than one domain.

## Testing

```bash
pnpm --filter @invoice-saas/api test
```

Vitest + Supertest against a real Postgres/Redis (via `infra/docker/docker-compose.yml`'s `postgres-test`/`redis` services) — the DB layer is never mocked, so these tests catch real transaction/constraint bugs, not just logic bugs.

## Known gaps

- Email sending (`src/lib/email.ts`) is a `console.log` stub pending a real provider.
- Razorpay/Stripe checkout-session creation isn't wired to live credentials; webhook *handling* is fully implemented and tested against synthetic signed payloads.
- No Dockerfile for the API itself yet (only its dev-time Postgres/Redis are Dockerized).
