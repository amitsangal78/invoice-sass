# apps/web

Next.js 15 (App Router) — the tenant-facing dashboard used by workspace `ADMIN`/`MEMBER` users. This is the primary app for running a business on Billify: create clients, create/send/track invoices, watch payments come in.

## Stack

React Server Components + Server Actions (no client-side API calls for mutations — auth tokens live in httpOnly cookies set directly by Server Actions via `cookies().set()`, never exposed to client JS). Tailwind CSS with the design-system's CSS-variable tokens (light/dark/primary themes — no hardcoded colors, no hand-rolled dark-mode variants). Shared UI components from `packages/ui` (shadcn/ui-based). TanStack Query for server-state caching, Zustand for client-only UI state. Every form validates against the same Zod schema the API uses, imported from `packages/types`.

## Structure

- `app/(auth)/{login,signup}/` — public auth routes
- `app/(dashboard)/{dashboard,clients,invoices}/` — authenticated routes, gated by `src/middleware.ts` (presence-only check; the real authorization happens server-side on every API call)
- `src/lib/api/server-client.ts` — server-only fetch wrapper that reads the httpOnly auth cookie and attaches it to API requests
- `src/features/auth/api/actions.ts` — Server Actions for login/signup/logout/workspace-selection
- `src/lib/invoicing/status.ts` — invoice status badge config + currency formatting, matching `.claude/steering/design-system.md` exactly
- `app/api/invoices/[id]/pdf/route.ts` — server-side proxy for the invoice PDF download (can't reuse `apiFetch`, which is JSON-only); reads the same httpOnly cookies, streams the binary response through same-origin so the token never reaches client JS

## Running

```bash
pnpm --filter @invoice-saas/web dev   # http://localhost:3000
```

Needs `apps/api` running — defaults to `http://localhost:4000/api/v1`, override with `API_BASE_URL`.

Log in with a seeded demo account (see root README) — `admin@billify.dev` / `DemoPass123!` — or sign up fresh from `/signup`.

## What's built

Marketing page, login/signup, workspace picker, dashboard, clients (list/create), invoices (list/create with dynamic line items, detail view, send/mark-paid/cancel actions, PDF download for non-draft invoices). Verified end-to-end against a live backend: signup → login → create client → create/send/pay an invoice → download its PDF → dashboard totals, all confirmed rendering real data via `curl` with real session cookies.

## Known gaps

Client/invoice edit UI, live SSE dashboard updates, and the client-portal frontend (the backend for all three already exists — see `.claude/specs/`) are not yet built.

## Testing

```bash
pnpm --filter @invoice-saas/web test   # vitest; no component tests written yet, passes with none
pnpm --filter @invoice-saas/web lint
```
