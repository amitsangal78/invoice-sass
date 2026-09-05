# Tech stack

Full scope, built now — no phased infra rollout. One stack decision per surface, chosen for what that surface needs.

| Layer | Choice | Why |
|---|---|---|
| Tenant web app | Next.js 15 (App Router) | Needs SEO on marketing pages *and* an authenticated dashboard + client portal in one app |
| Internal admin console | React 19 + Vite + Zustand | Pure authenticated tool, no SEO need — Vite's dev speed wins with nothing to trade off |
| Styling | Tailwind (utilities) + CSS Modules (bespoke layout) + shadcn/ui (editable components) | |
| Component docs | Storybook in `packages/ui` | One visual source of truth shared by web + admin |
| Theming | CSS variables + a token layer (light/dark) | Never duplicate component variants per theme |
| API | Node.js 22 + Express + zod validation | Boring and correct beats a heavier framework at this scale; modular monolith, not microservices |
| Database | Neon PostgreSQL + Drizzle ORM | Relational data with real foreign keys, not document-shaped; Neon for serverless scaling + branching (see below). Drizzle over Prisma: lighter runtime, SQL-shaped queries (matches the "boring and correct" Express stance), first-class Neon serverless driver support. |
| Authentication | Self-built JWT (access + refresh) | Full control over the signup/verify/reset/session flow; see below for what this makes *us* responsible for |
| Authorization | Node.js + PostgreSQL (`workspace_members`) | The JWT identifies the user; the app answers "which workspace, what role, what's allowed" — see below |
| Cache | Redis (ElastiCache) | Workspace/permission/dashboard caching, rate limiting, idempotency keys — see the Redis conventions section |
| Bloom filter | In-process/Redis-backed, selective use only | Negative-lookup optimization for high-volume existence checks (public invoice ids, portal tokens) — never for authorization, see below |
| State (frontend) | Zustand (client state) + TanStack Query (server state) | Don't duplicate server state into the store |
| Mobile | React Native (Expo) | Shares `packages/types` with the API; OTA updates without app-store review for most changes |
| Real-time | Server-Sent Events (SSE), where useful | Payment/status updates pushed to the dashboard; see rationale below |
| Background jobs | BullMQ + Redis | Reminders, PDF generation, scheduled overdue transitions, webhook fan-out |
| Payments (invoice) | Razorpay (India-first) + Stripe (international), behind a shared `createPaymentLink()`/`verifyWebhook()` interface | |
| Payments (subscription) | Razorpay/Stripe subscription billing — a **separate** flow from invoice payments, never conflated | |
| Email | AWS SES | |
| File storage | S3 | Invoice PDFs, uploaded logos/branding assets |

## Self-built auth — what this makes us responsible for

Cognito was evaluated and dropped in favor of a self-built JWT flow, for full control over the auth UX. That trade means the backend, not a managed service, now owns everything below — treat this list as non-negotiable minimum correctness, not optional hardening:

- **Password hashing**: Argon2 (preferred) or bcrypt — never anything weaker, never plain storage.
- **Access token**: short-lived (~15 min), minimal claims — `{ sub: userId, platformRole }` only. Workspace/role is *never* embedded in the token; it's resolved from `workspace_members` per request (see below) so a role change or removal takes effect immediately, not at next token refresh.
- **Refresh token**: longer-lived (7–30 days), stored **hashed** in Postgres (`refresh_tokens`), rotated on use, individually revocable (logout-this-device) and bulk-revocable (logout-all-devices, password reset).
- **Email verification** and **password reset**: secure random tokens, stored hashed with an expiry, single-use (mark used, don't just check expiry).
- **Session expiry handling** on the frontend: a silent refresh attempt, then a clean re-login prompt — never a confusing half-authenticated state.

```
Signup/Login → Node.js Auth API (hash/verify, issue JWT) → Postgres (users, refresh_tokens)
```

## Why the JWT doesn't own authorization

The JWT answers "who are you." It does **not** become the source of truth for role/permission — a claim baked into the token can't represent a user who is `ADMIN` in Workspace A and `MEMBER` in Workspace B, and can't be revoked before the token naturally expires. That lives in Postgres, resolved fresh on every request:

```
workspace_members
  user_id
  workspace_id
  role        -- ADMIN | MEMBER

users
  platform_role   -- SUPER_ADMIN | SUPPORT_ADMIN | NORMAL_USER; NORMAL_USER is the default for every tenant user, not workspace-scoped
```

Every request: valid access token → resolve workspace membership (cache-assisted, see Redis conventions) → check role permission → check resource (`invoice.workspace_id === session.workspace_id`) → allow. See `rules/backend-api.md`.

## Why SSE, not Kafka

The real-time need is moderate and single-direction: a payment webhook lands → Postgres updates → the dashboard should reflect it without a refresh. SSE covers that directly:

```
Payment webhook → Node.js → PostgreSQL → SSE → Browser/Mobile
```

Kafka is a deliberate exclusion, not a "not yet" — it earns its place only with multiple independent consumers of the same event stream at real scale (distributed microservices, event replay, analytics pipelines). None of that exists here, and this is a modular monolith by design. Revisit only if a concrete multi-consumer need actually appears — don't reach for it speculatively.

## Redis conventions

Redis accelerates reads and backs three mechanisms — it is never the source of truth; Postgres always is. If Redis is unavailable, the app degrades in performance, never in correctness (fall through to Postgres).

- **Caching** — every key includes the workspace id, no exceptions: `workspace:{workspaceId}:settings`, `workspace:{workspaceId}:permissions:{userId}`, `workspace:{workspaceId}:dashboard`, `workspace:{workspaceId}:invoice:{invoiceId}`. A cache key without a workspace scope (`invoice:{id}`) is a tenant-isolation bug, not a style nit. TTLs are set per type and tuned later, not left unset: settings ~10–30 min, dashboard ~30–120 sec, permissions ~5–15 min, invoice detail ~1–5 min.
- **Invalidation** — after a mutation commits to Postgres, delete/update the affected keys (invoice cache + dashboard cache) in the same request path, not via a lagging background sweep.
- **Rate limiting** — login attempts, password-reset attempts, public payment-link access, general API abuse control.
- **Idempotency** — short-lived keys for payment creation and webhook processing, e.g. `idempotency:razorpay:{eventId}`, in addition to (not instead of) the durable `webhook_events` table — Redis catches the fast-path duplicate, Postgres is the permanent record.

Never store in Redis: plain passwords, JWT signing secrets, card data, or anything that must survive a cache eviction as the only copy.

## Bloom filter — narrow, deliberate use

A Bloom filter is used **only** for high-volume negative-existence checks where a wrong "possibly exists" is cheap and a wrong "definitely absent" would be a bug. Good candidates: public invoice-link ids, client-portal tokens, webhook event ids at high volume. Flow: filter says "definitely absent" → return not-found immediately, skip Postgres; filter says "possibly present" → fall through to Redis/Postgres for the real check.

Hard rules:
- **Never use it for authorization** — not role, not workspace access, not payment authorization, not invoice ownership, not login. A false positive there would be a security bug, not a performance one.
- A positive result is always re-verified against Redis/Postgres; a negative result is only trusted if the filter is correctly maintained (rebuild from Postgres on restart/deploy; support re-population and versioning).
- If the filter is unavailable, skip it and fall through to the normal Redis/Postgres check — correctness never depends on the Bloom filter being up.

## Currency

Multi-currency per invoice from day one — `invoices.currency` + `NUMERIC`/`DECIMAL` for every monetary column, never `float`. No conversion engine: reports group totals by currency (₹50,000 + $2,000 stays two lines, never summed into one number). FX conversion is a distinct, unbuilt feature — see non-goals in `product.md`.

## Infra (AWS, ap-south-1 / Mumbai as primary region if India-first)

- **Compute**: ECS on Fargate running the API as a modular monolith, behind an ALB. (App Runner is a legitimate simpler substitute for the same container if you want less to operate — pick one, don't run both.)
- **Database**: Neon PostgreSQL — not RDS. Neon is a separate managed provider (serverless Postgres, branching for preview/test environments), reachable from the AWS compute layer over the network; pick its region to match `ap-south-1` for latency, but it isn't provisioned inside the AWS account like RDS would be.
- **Cache/queue backing**: ElastiCache Redis (BullMQ + rate-limit counters + the caching/idempotency conventions above).
- **Storage**: S3 (PDFs, branding assets) + CloudFront if serving them publicly.
- **Email**: SES.
- **Auth**: self-built (see above) — no external auth provider.
- **Web + Admin hosting**: S3 + CloudFront, or Amplify Hosting for simpler CI/CD — pick one; Amplify is faster to stand up, S3+CloudFront is more control.
- **Mobile builds**: EAS Build + EAS Submit (Expo).
- **Secrets**: AWS Secrets Manager / env vars — never committed. This now also covers the JWT signing secret(s), which didn't exist as a concern under Cognito.
- **Backups**: Neon's own point-in-time recovery/branching covers most of this; still confirm a retention window (7-day minimum) explicitly rather than assuming Neon's default matches what you need.

Region expansion (US/EU/AU) only if a real customer or data-residency requirement demands it — not speculative.

## Rate limiting

`express-rate-limit` backed by Redis, applied to every public/unauthenticated endpoint from day one: signup, magic-link request (client portal), webhooks, public payment links.

## Testing

- Backend: Vitest + Supertest, against a real Dockerized test Postgres — not mocked queries.
- Frontend: Vitest + React Testing Library — test user-visible behavior, not implementation detail.
- E2E: Playwright, covering flows that span systems (signup → invite member → create invoice → send → pay via webhook → status change; client portal magic-link → pay).

## CI/CD

- One GitHub Actions workflow per app, gated by Turborepo's affected-package detection.
- DB migrations run as their own gated CI step *before* the new API image goes live — never inside app startup code.

## Pre-commit workflow

Two deliberately separate pieces — see the discussion in `product.md`'s history: automatic AI test generation on every commit was ruled out (cost, latency, and an AI-authored test for invoice/payment logic shouldn't ship ungated by human review).

1. **Deterministic gate (`.husky/pre-commit` → `lint-staged`)**: on every `git commit`, runs `eslint --fix` on staged `.ts`/`.tsx` files, then `turbo run test --filter=...[HEAD]` (the affected packages' real test suites). Blocks the commit on any failure. Fast, free, same behavior every time — configured in root `package.json`'s `lint-staged` field.
2. **Test writing (`test-writer` agent, `.claude/agents/test-writer.md`)**: invoked deliberately, before committing — never automatically. Reads changed files plus the relevant rules/skills/specs, writes or updates the corresponding Vitest tests, runs them, and reports. The developer reviews the diff like any other AI-authored code before staging and committing it — at which point the deterministic gate above runs for real.

Status: live and doing real work — `identity-and-rbac` is implemented, and the hook runs real ESLint + `turbo run test` (24 passing integration tests against a Dockerized Postgres/Redis) on every commit touching `apps/api`/`packages/db`/`packages/types`. Two fixes made while wiring this up, worth remembering: (1) the pre-commit script explicitly sources `.nvmrc`'s pinned Node 22 — git hooks run non-interactively and don't inherit an interactive shell's nvm state; (2) `lint-staged`'s test command falls back to a full `turbo run test` when `HEAD` doesn't resolve yet (the very first commit in the repo), since `--filter=...[HEAD]` has nothing to diff against at that point. Stub apps (`web`, `admin`, `mobile`, `ui`, `email-templates`) still use the placeholder `vitest run --passWithNoTests` script but now actually have `vitest` installed, so the gate passes cleanly rather than erroring on a missing binary.

## Audit trail

`invoice_events` logs every financial-state-changing action (created, updated, sent, marked paid, payment received/failed, cancelled, reminder sent) with `workspace_id`, `invoice_id`, `user_id`, before/after values, IP, timestamp. Financial operations don't silently disappear — this also backs `SUPPORT_ADMIN`'s support-only visibility into tenant data.
