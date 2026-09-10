# Local dev infrastructure

## Ports

| Service | Port | Source |
|---|---|---|
| API | 4000 | `apps/api` (`PORT` in `.env`) |
| Web | 3000 | `apps/web`, Next.js dev server |
| Admin | 5173 | `apps/admin`, Vite dev server |
| Mobile / Metro | 8081 | `apps/mobile`, Expo |
| Postgres (dev) | 5435 | Local Homebrew `postgresql@18` — see below |
| Postgres (Docker dev, unused) | 5434 | `infra/docker/docker-compose.yml`'s `postgres` service |
| Postgres (Docker test) | 5433 | `infra/docker/docker-compose.yml`'s `postgres-test` service — used by CI/anyone without a local Postgres; local dev here points at 5435 instead (see below) |
| Postgres (system, pre-existing) | 5432 | A separate system-level PostgreSQL 15 install, unrelated to this project, permission-locked — **don't touch it** |
| Redis | 6379 | Local Homebrew `redis` (`brew services start redis`). The Docker compose file still defines a `redis` service as a fallback, but local dev uses the Homebrew one — Docker Desktop stopping mid-session took the cache down twice. |

## The multi-Postgres story (read this before touching `DATABASE_URL`)

This machine ended up with **three separate Postgres installs** at once, discovered the hard way:

1. **Docker Compose** (`infra/docker/docker-compose.yml`) — `postgres` on 5434, `postgres-test` on 5433. Always available if Docker Desktop is running; this is what CI-equivalent testing assumes.
2. **A pre-existing system PostgreSQL 15** (`/Library/PostgreSQL/15`) — occupies port **5432**, permission-locked, entirely unrelated to this project. Do not attempt to guess/reset its credentials or repoint anything at it; if 5432 "isn't responding as expected," this is almost always why.
3. **Homebrew `postgresql@18`** — reconfigured to run on port **5435** (its default 5432 was already taken by #2). This is the actual local dev database for this project (`apps/api/.env`'s `DATABASE_URL`), per an explicit decision to use local Postgres over Docker.

Two databases live on that same local PG18 instance: `invoice_saas_dev` (what the running app uses — has seeded demo data, **never truncated by tests**) and `invoice_saas_test` (what `apps/api/vitest.config.ts` points `DATABASE_URL` at — truncated between every test, see `apps/api/src/test/setup.ts`). Keep them separate; running tests against `_dev` would wipe the demo accounts.

If Postgres or Redis isn't running, `brew services list` shows it and `brew services start <name>` fixes it — this has already come up more than once. A whole-suite failure with `[ioredis] Unhandled error event` is Redis being down, not a code regression.

## Env vars (`apps/api/.env`, gitignored)

| Var | Notes |
|---|---|
| `DATABASE_URL` | Points at local PG18 (`invoice_saas_dev`), port 5435 |
| `REDIS_URL` | Local Redis, port 6379. The **only** cache in the system — Memcached was trialled as a second long-TTL tier and then removed; long-lived entries (invoice PDFs) just use a long Redis TTL. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER` | Dev-only values, fine as-is locally |
| `PORT` | API port, 4000 |
| `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET` | Placeholders until real provider credentials exist |

## Demo accounts

`pnpm --filter @invoice-saas/api seed:demo` — one account per role, idempotent, re-runnable any time. See the root `README.md` for the full table; `seed-admin.ts` is the lower-level script it's built on for platform-staff accounts specifically.
