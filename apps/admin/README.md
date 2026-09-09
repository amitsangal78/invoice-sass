# apps/admin

React 19 + Vite SPA — the internal console for platform staff (`SUPER_ADMIN`/`SUPPORT_ADMIN`), not for tenant users. Cross-tenant visibility that `apps/web` deliberately never has.

## Stack

Vite + React 19, TanStack Query for server state, Zustand for auth state — kept **in-memory only, no persistence** (see `src/store/auth-store.ts`). That's a deliberate trade-off for a low-traffic internal tool: a page refresh logs you out, in exchange for zero token-persistence attack surface. `packages/types` Zod schemas reused for any form validation.

## Structure

- `src/pages/{login-page,dashboard-page}.tsx` — the whole app is currently these two views
- `src/components/protected-route.tsx` — route guard, redirects to login if the in-memory session is empty
- `src/lib/api-client.ts` — fetch wrapper against the API's admin-only endpoints
- `src/store/auth-store.ts` — session state (see the in-memory trade-off note above)

## Running

```bash
pnpm --filter @invoice-saas/admin dev   # http://localhost:5173
```

Needs `apps/api` running — defaults to `http://localhost:4000/api/v1`, override with `VITE_API_BASE_URL`.

There's no self-service signup for this app by design. Bootstrap a login with:

```bash
pnpm --filter @invoice-saas/api seed:admin -- <email> <password> SUPER_ADMIN
# or use the seeded demo account: superadmin@billify.dev / DemoPass123! (see root README)
```

## What's built

Login, workspace list (cross-tenant), suspend/reactivate a workspace (owner-role-gated in the UI, enforced server-side regardless — the API doesn't trust the client). Every admin write is audit-logged server-side (`withAdminAuditLog`). Verified end-to-end with a real headless-browser run against the live API: login → dashboard renders real workspace data → suspend/reactivate both confirmed working, zero console errors.

Suspending a workspace invalidates that workspace's cached permissions immediately (via a Redis `SCAN`-based cache-pattern invalidation) rather than waiting out the cache TTL — this was a real bug found and fixed during implementation, see `apps/api/src/lib/redis.ts`.

## Known gaps

No audit-log viewer UI yet (the data is written; there's no page to browse it). No workspace search/filter/pagination beyond the initial list.

## Testing

```bash
pnpm --filter @invoice-saas/admin test        # vitest; no component tests written yet, passes with none
pnpm --filter @invoice-saas/admin typecheck
pnpm --filter @invoice-saas/admin lint
```
