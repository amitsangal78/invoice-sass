---
name: saas-architecture-conventions
description: Use whenever scaffolding, extending, or making an infrastructure/architecture decision in Amit's Next.js + Node.js + PostgreSQL + AWS SaaS projects (starting with the Invoice + Payment Reminder SaaS) — creating a new app/package/top-level folder, adding an API route, writing a DB migration, setting up Docker/CI, or deciding whether Redis, Kafka/SSE, RBAC, rate limiting, or background jobs are needed yet. Always consult this before creating new top-level structure or reaching for infra that isn't already in the stack.
---

# SaaS architecture conventions

These are Amit's standing conventions for building multi-app SaaS products (Next.js tenant app + Node.js API + PostgreSQL, an admin console, and a React Native app — all built together, not staged). They exist so the architecture never has to be restructured mid-build as more surfaces come online — new capability gets *added*, not retrofitted. Follow them by default; deviate only when the user explicitly asks for something different.

## Repository shape

One pnpm + Turborepo monorepo, not separate repos per app, even if only one app exists today:

```
<project>/
├── apps/
│   ├── web/        # Next.js — marketing site + tenant dashboard (the core product)
│   ├── admin/       # React + Vite — internal ops console (cross-tenant, RBAC-gated)
│   ├── api/         # Node.js + Express — REST API
│   └── mobile/      # React Native (Expo) — thin client over the same API
├── packages/
│   ├── ui/          # shadcn components + Tailwind config + Storybook
│   ├── db/          # Drizzle schema + migrations, shared by api
│   ├── types/        # shared zod schemas / TS types (API ⇄ web ⇄ mobile)
│   ├── email-templates/
│   └── config/       # eslint, tsconfig, tailwind presets
├── infra/
│   ├── docker/       # Dockerfiles + docker-compose.yml (local dev)
│   └── aws/          # Terraform/CDK — only once there's real infra to describe
└── .github/workflows/
```

Scaffold every folder that the *product* will eventually need (including apps that don't exist yet), even if most of them start empty — but only write code inside a folder when a real feature needs it. An empty `apps/admin/` costs nothing; a premature `infra/aws/terraform` full of speculative resources costs real maintenance.

**Placement rule:** anything imported by more than one app (DB schema, shared types, email templates, UI components) goes in `packages/`. Anything that only makes sense inside one app stays inside that app. This single discipline is what keeps a 4-app monorepo scalable instead of tangled — check it before adding a new shared file.

## One stack decision per surface, not one stack for everything

| Surface | Stack | Why |
|---|---|---|
| Public site + tenant dashboard | Next.js (App Router) | Needs SEO on marketing pages *and* an authenticated app in one codebase |
| Internal admin console | React + Vite + Zustand | Pure authenticated tool, no SEO need — Vite's dev speed wins with nothing to trade off |
| API | Node.js + Express + zod validation | Boring and correct beats a heavier framework at this scale |
| DB | Neon PostgreSQL + Drizzle | Relational data with real foreign keys, not document-shaped; Neon for serverless scaling + branching |
| Styling | Tailwind (utilities) + CSS Modules (bespoke layout) + shadcn/ui (editable components, not a black box) | |
| Theming | CSS variables + a token layer, light/dark from the same tokens | Never duplicate component variants per theme |

When asked to add a new surface (a new dashboard, a customer portal, an internal tool), decide its stack from this table's *reasoning*, not by copying whichever app was built most recently.

## Infrastructure is built now, not deferred — but still justified, not speculative

There is no phased rollout on this project — the full role/workspace/client-portal/subscription scope is being built in one pass, so the infrastructure that scope actually requires is in from day one:

- **Redis** — in, backing BullMQ (reminders, PDF generation, webhook fan-out) and rate-limit counters. Justified by the reminder engine and public webhook endpoints existing from the start.
- **Background jobs (BullMQ)** — in. Reminders, scheduled overdue-status transitions, and PDF generation all run off the request path from day one.
- **RBAC** — in. `workspace_members` + `platform_role` + `client_users` is the tenancy model itself, not an add-on — see the domain skill. There is no simpler "just `user_id` scoping" stage before this; the client portal and team-member roles ship together with everything else.
- **Rate limiting** — in, on every public/unauthenticated endpoint (webhooks, signup, magic-link request, public payment links).
- **Kafka** — still excluded, but as a deliberate architectural call, not a "not yet." It earns its place only with multiple independent consumers of the same event stream at real scale. SSE covers the actual real-time need here (payment/status updates). If asked for Kafka speculatively, name SSE/the job queue as the simpler fit first — this isn't about timing, it's that Kafka isn't the right tool for this shape of problem.
- **AWS (ECS/Fargate or App Runner, Neon Postgres, ElastiCache, S3, SES) + self-built auth** — built as the real target now, not a minimal placeholder. Still a modular monolith, not microservices — don't split services or add a VPC-per-tenant/multi-account topology without a concrete requirement forcing it.

When the user asks "do we need X yet," the answer for this project is "yes, it's in the current build" for everything on this list except Kafka — Kafka stays a "no" until a genuine multi-consumer streaming need appears.

## Testing conventions

- Backend: Vitest + Supertest, run as integration tests against a real Dockerized test Postgres — not mocked queries. For relational schemas (foreign keys, transactions, status transitions), mocks hide the bugs that matter.
- Frontend: Vitest + React Testing Library, testing user-visible behavior (what renders, what a click does), not implementation detail.
- Add Playwright end-to-end coverage once there's a flow that spans systems worth protecting (e.g., signup → invoice → pay → webhook → status change) — not before, and not for everything.

## CI/CD conventions

- One GitHub Actions workflow per app (`api-deploy.yml`, `web-deploy.yml`, …), gated by Turborepo's affected-package detection so an unrelated app's change doesn't rerun everything.
- DB migrations run as their own gated CI step *before* the new app image goes live — never inside application startup code, where a crash-looping container can re-run a migration repeatedly.

## Error handling & logging conventions

- One centralized Express error middleware, one response shape: `{ error: { code, message } }`. Don't let individual routes invent their own error shapes.
- Structured JSON logs (pino) from day one, even before there's a log aggregator to send them to — every log line carries a request id and, once auth exists, the acting `user_id`, so one request or one invoice's lifecycle can be traced end to end.

## When scaffolding a brand-new feature

1. Decide which existing app it belongs in using the surface table above — don't create a new app for a feature that fits an existing one.
2. Decide `apps/` vs `packages/` placement using the sharing rule above.
3. Write the migration in `packages/db` first, then the API route, then the UI — schema drives the feature, not the other way around.
4. Only reach for Redis/jobs/RBAC/rate-limiting/Kafka if this specific feature is the one that needs it (see the list above); otherwise build it without them.
