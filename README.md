# Billify — Invoice & Payment Reminder SaaS

Billify is a multi-tenant SaaS for small businesses to create invoices, track payments, and automatically remind clients about due/overdue bills. It ships as four apps sharing one backend: a tenant-facing web dashboard, a mobile app, an internal admin console, and the REST API that powers all three.

This is a monorepo built spec-first (see [Methodology](#methodology) below) — every feature exists because a written spec under `.claude/specs/` describes its requirements, design, and task breakdown before any code was written.

## Apps

| App | Path | Stack | Who uses it |
|---|---|---|---|
| API | [`apps/api`](apps/api/README.md) | Node 22, Express, Drizzle/Postgres, Redis | Backs all three clients below |
| Web | [`apps/web`](apps/web/README.md) | Next.js 15 (App Router) | Business owners/staff (`ADMIN`, `MEMBER`) |
| Mobile | [`apps/mobile`](apps/mobile/README.md) | React Native / Expo Router | Same tenant users, on the go |
| Admin | [`apps/admin`](apps/admin/README.md) | React 19 + Vite | Platform staff (`SUPER_ADMIN`, `SUPPORT_ADMIN`) |

Each app's README covers its own setup, environment variables, and verification status in detail — this file covers what's shared across all of them.

## Shared packages

| Package | Purpose |
|---|---|
| `packages/db` | Drizzle ORM schema (all tables), migrations, DB client — the single source of truth for the data model |
| `packages/types` | Zod schemas shared between API validation and frontend forms, so request/response shapes are never redefined twice |
| `packages/ui` | Shared shadcn/ui-based React components (used by `apps/web`) |
| `packages/email-templates` | Transactional email templates |
| `packages/config` | Shared ESLint/TS config |

## Domain model, in brief

- **Multi-tenancy**: everything belongs to a `workspace`. A user can be a member of multiple workspaces via `workspace_members`.
- **RBAC**: two platform roles (`SUPER_ADMIN`, `SUPPORT_ADMIN` — cross-tenant, `apps/admin` only) and two workspace roles (`ADMIN`, `MEMBER` — scoped to one workspace, `apps/web`/`apps/mobile`). A separate `USER` principal (`client_users`) is a workspace's own client, authenticated into a read-only client portal via passwordless magic link — not a platform/workspace role at all.
- **Invoicing**: clients → invoices (with line items, decimal-safe money math via `decimal.js`) → payments, with a state machine (`DRAFT → SENT → PARTIALLY_PAID/PAID → ...`, plus `CANCELLED`) and automatic reminders (`reminder_rules`/`reminder_events`) at configurable offsets from the due date.
- **Payments & subscriptions**: Razorpay/Stripe webhook handling (HMAC-verified, idempotent via `webhook_events`), and a separate subscription-billing path (`subscription_webhook_events`) kept in its own files by design — the subscription path must never touch invoice/payment state directly.
- **Real-time**: Server-Sent Events (SSE), not a message broker — deliberate choice for this scale (see `.claude/steering/tech.md`).

Full requirements/design/task breakdown for each of these four areas lives under [`.claude/specs/`](.claude/specs/) (`identity-and-rbac`, `core-invoicing`, `client-portal`, `subscription-billing`).

## Running everything locally

Prerequisites: Node 22+, pnpm 10, a local Postgres and Redis (Docker Compose files are provided in `infra/docker/`, or point at any instances you already run).

```bash
pnpm install

# apps/api needs a .env — see apps/api/README.md for every variable.
# Minimum: DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_PEPPER

pnpm --filter @invoice-saas/db db:migrate   # apply the schema
pnpm --filter @invoice-saas/api seed:demo   # one demo account per role, see below

pnpm dev   # turbo runs dev in every app in parallel
```

Or start apps individually — see each app's README for its exact command and port.

| App | Default URL |
|---|---|
| API | http://localhost:4000 |
| Web | http://localhost:3000 |
| Admin | http://localhost:5173 |
| Mobile (Metro) | http://localhost:8081 |

### Demo accounts

`pnpm --filter @invoice-saas/api seed:demo` (re-runnable, idempotent) creates one account per role:

| Role | Email | Password | App |
|---|---|---|---|
| `SUPER_ADMIN` | `superadmin@billify.dev` | `DemoPass123!` | apps/admin |
| `SUPPORT_ADMIN` | `supportadmin@billify.dev` | `DemoPass123!` | apps/admin |
| `ADMIN` | `admin@billify.dev` | `DemoPass123!` | apps/web, apps/mobile |
| `MEMBER` | `member@billify.dev` | `DemoPass123!` | apps/web, apps/mobile |
| `USER` (client portal) | `client@billify.dev` | none — passwordless | magic-link URL printed by the script |

## Testing

```bash
pnpm test    # turbo run test — every app/package, backend tests hit a real (Dockerized) Postgres/Redis, never mocked
pnpm lint
pnpm build
```

A Husky pre-commit hook runs lint + tests scoped to changed packages on every commit (falls back to the full suite on a repo's first commit).

## Methodology

This project follows a spec-driven workflow rather than ad-hoc prompting:

- `.claude/steering/` — durable, project-wide docs: `product.md`, `tech.md`, `structure.md`, `architecture-principles.md`, `design-system.md`.
- `.claude/specs/<feature>/` — per-feature `requirements.md` → `design.md` → `tasks.md`, written and approved in that order before implementation starts. Each `tasks.md` is checked off as work lands, with honest notes on any deviation.
- `.claude/rules/` — narrow, always-apply conventions for specific areas (`backend-api.md`, `frontend-web.md`, `mobile.md`).

There were deliberately no deferred phases in this build — RBAC, multi-tenancy, multi-currency, and audit trails were all built as part of the initial implementation rather than left for "later."

## AI-assisted development infrastructure

Beyond the spec-driven workflow above, this repo carries a small set of tools aimed specifically at making AI coding sessions (this one and future ones) faster and more accurate on a codebase that's already sizable. None of these are speculative — each backs something real.

| | What it is | Where |
|---|---|---|
| **OpenWiki** | A current-state system wiki — one page per domain, meant to be read *before* an AI agent (or a person) changes code in that area | [`.claude/wiki/`](.claude/wiki/README.md) |
| **Graphify** | A compact, hand-authored functionality graph — what depends on/is consumed by what, across domains — so a cross-cutting change doesn't require re-reading the whole repo | [`.claude/graph/functionality-graph.md`](.claude/graph/functionality-graph.md) |
| **Mistakes log** | A running list of real bugs hit during this build (root cause, fix, how to avoid it again) | [`.claude/wiki/mistakes.md`](.claude/wiki/mistakes.md) |

**OpenWiki** — pros: a fresh AI session (or a new team member) gets accurate current-state context in a few short pages instead of re-deriving it from the whole codebase every time; separates "how it works now" from `.claude/specs/`'s "why it was decided," so neither doc has to do both jobs. Cons: it's maintained documentation, not generated — it will drift if changes land without updating it (mitigated by `.claude/rules/ai-context-workflow.md` making the update step part of the workflow, not optional), and it's genuinely more pages to keep honest as the codebase grows.

**Graphify** — pros: answers "what else does this touch" in one file instead of a repo-wide grep, which is both faster and less token-expensive for an AI agent mid-task; the curated relationships (why a file boundary exists, not just that an import exists) are exactly what a mechanical import-graph tool can't produce. Cons: hand-authored means it's only as current as its last update — deliberately not auto-generated from static analysis (see the trade-off note at the bottom of the graph file itself) because that would need a meaningfully bigger tool for a benefit judged not to justify it yet; revisit if staleness becomes a recurring real problem.

**Mistakes log** — pros: turns a one-time debugging session into a permanent, cheap-to-read asset — the three-Postgres-instances confusion, the invoice-numbering off-by-one, and others like them cost real time once and should never cost that again. Cons: only as useful as the discipline to actually append to it (same drift risk as the wiki, same mitigation via the rule file), and it's easy to under- or over-log — the guidance is to log the mistakes that would surprise a future reader, not routine bugs with an obvious cause.

## Known gaps

Documented plainly rather than hidden — see each app's own README for specifics:

- Email sending and file storage (S3) are stubbed (console.log / not yet wired to a provider) pending real credentials.
- Payment/subscription provider checkout flows are implemented up to webhook handling; initiating a live checkout session needs real Razorpay/Stripe API keys.
- `apps/mobile` runs and its Home screen is verified against live data; the Invoice List and Create Invoice screens are written and type-check but haven't been seen rendering (see `apps/mobile/README.md`). Android hasn't been run at all.
- The client-portal frontend (backend is complete) isn't built yet.
- `packages/ui` and `packages/email-templates` are empty package shells, though several docs describe `packages/ui` as the shared component library — `apps/web` and `apps/admin` each hand-roll their own copies instead.
- `users` has no name column, so the dashboard greets without one; `workspaces` has no business-profile fields (address, tax id, logo, default currency), which leaves the `customBranding` plan gate with nothing to gate.
- Receipt numbers come from an in-memory counter (`services/invoicing/receipts.ts`) — they reset on restart and aren't workspace-scoped. Known bug, not yet fixed.
- Dark mode is web-only; `apps/mobile` is light-only.
- No frontend tests anywhere — all 122 tests are backend.
- No CI/CD pipeline or production deployment (Neon/AWS) configured yet.
