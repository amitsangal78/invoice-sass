# Repository structure

pnpm + Turborepo monorepo. Scaffold every folder the product will eventually need — even empty — so growth is additive, never a restructure.

```
invoice-saas/
├── apps/
│   ├── web/              # Next.js — marketing site + tenant dashboard + client portal
│   ├── admin/            # React + Vite — internal ops console (SUPER_ADMIN / SUPPORT_ADMIN)
│   ├── api/              # Node.js + Express — REST API
│   └── mobile/           # React Native (Expo)
├── packages/
│   ├── ui/                # shadcn components + Tailwind config + Storybook
│   ├── db/                # Drizzle schema + migrations
│   ├── types/              # shared zod schemas / TS types (API ⇄ web ⇄ mobile)
│   ├── email-templates/    # React Email templates
│   └── config/             # eslint, tsconfig, tailwind presets
├── infra/
│   ├── docker/              # Dockerfiles + docker-compose.yml (local dev)
│   └── aws/                 # Terraform/CDK — only once there's real infra to describe
├── .github/workflows/
├── .claude/
│   ├── skills/
│   ├── steering/            # this folder
│   ├── specs/
│   └── bugs/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Placement rule (top level)

Anything imported by more than one app (DB schema, shared types, email templates, UI components) goes in `packages/`. Anything that only makes sense inside one app stays inside that app.

## Internal structure of `apps/web` — feature-based, not file-type-based

Adapted from a mature reference implementation (tab-website). Every domain gets a `features/<domain>/` folder, not a scattered `components/`, `hooks/`, `store/` split by file type:

```
apps/web/src/
├── app/                     # routes only — page.tsx, layout.tsx, loading.tsx, error.tsx, route.ts
│   ├── (public)/             # marketing — unauthenticated
│   ├── (dashboard)/           # tenant dashboard — auth-gated
│   └── api/                   # BFF route handlers, thin adapters only
├── features/
│   ├── auth/
│   │   ├── api/                # TanStack Query hooks for this feature's backend calls
│   │   ├── components/         # feature-specific UI
│   │   ├── hooks/               # business-logic hooks composing store + api
│   │   ├── constants.ts         # domain-specific constants/types
│   │   ├── auth-store.ts        # this feature's Zustand slice, if it needs one
│   │   └── index.ts             # PUBLIC API — the only import target for other features
│   ├── clients/
│   ├── invoices/
│   └── dashboard/
├── shared/
│   ├── components/            # domain-aware, reused by 2+ features (e.g. <StatusBadge>)
│   ├── hooks/                  # generic hooks (useDebounce, useMediaQuery)
│   └── constants/               # global constants — route paths, feature-flag keys
├── lib/
│   ├── invoicing/                # pure, stateless domain knowledge: types, constants, formatters
│   ├── api/                       # HTTP client setup, shared fetch wrapper
│   └── server/                     # server-only integrations (never imported by client code)
├── components/ui/           # shadcn primitives — zero domain knowledge, could work in any project
├── store/                    # TanStack Query client setup; a root Zustand store only if truly global
└── providers/                 # QueryClientProvider, ThemeProvider, AuthProvider
```

### Dependency hierarchy (strict — same rule for every app in this repo)

```
app/ → features/ → shared/ → lib/
```

- `app/` imports from `features/` (public API only), `shared/`, and `lib/`.
- `features/` imports from `shared/`, `lib/`, and other features' **public API** (`index.ts`) — never another feature's internal file.
- `shared/` imports from `lib/` only — never from `features/` or `app/`.
- `lib/` is self-contained — never imports from `features/`, `shared/`, or `app/`.

This is what makes `lib/invoicing/` safe to import from a route handler, a shared component, *and* a feature — because it has no dependency going the other way.

### `lib/<domain>/` vs `features/<domain>/` — the ownership boundary

| Belongs in `lib/invoicing/` | Belongs in `features/invoices/` |
|---|---|
| TypeScript types (`Invoice`, `InvoiceStatus`) | Zustand store / TanStack Query hooks |
| Constants (`INVOICE_STATUSES`, due-date thresholds) | React components |
| Pure formatters/validators (`formatInvoiceNumber()`) | Feature-specific UI-only constants |
| Route path contracts | Anything depending on React, browser APIs, or app state |

Rule of thumb: if you can imagine a route handler, an API client, *or* a second feature needing this file, it goes in `lib/`. If it only ever runs inside one feature's components and hooks, it goes in `features/`.

### Three-tier component placement

| Tier | Location | Domain knowledge | Reuse scope |
|---|---|---|---|
| 1. Design-system primitives | `components/ui/` | None | Any project |
| 2. Shared domain components | `shared/components/` | Yes, but not feature-specific | 2+ features |
| 3. Feature-specific components | `features/<domain>/components/` | Yes, feature-specific | One feature only |

### Feature public API pattern

Every feature exposes an `index.ts` barrel. Other features and `app/` routes import only from it:

```ts
// ✅ features/invoices/index.ts
export { useInvoice, useCreateInvoice } from './api/invoice-queries';
export { InvoiceStatusBadge } from './components/invoice-status-badge';
export type { Invoice, InvoiceStatus } from '@/lib/invoicing';

// ✅ another feature consumes via the public API
import { useInvoice } from '@/features/invoices';

// ❌ deep import into another feature's internals
import { useInvoice } from '@/features/invoices/api/invoice-queries';
```

### File naming (all apps)

| Kind | Pattern | Example |
|---|---|---|
| Component | `kebab-case.tsx` | `invoice-status-badge.tsx` |
| Hook | `use-<name>.ts` | `use-invoice.ts` |
| Store slice | `<feature>-store.ts` | `invoices-store.ts` |
| Domain constants | `<domain>-constants.ts` | `invoicing-constants.ts` |
| Domain types | `<domain>-types.ts` | `invoicing-types.ts` |
| Test (colocated) | `<name>.test.ts(x)` | `invoice-status-badge.test.tsx` |

React component **identifiers** stay PascalCase regardless of filename.

## `apps/api` — the same shape, backend flavor

```
apps/api/src/
├── routes/                # thin route handlers — parse request, call a service, shape response
│   └── invoices/route.ts
├── services/                # business logic: status transitions, invoice numbering, plan gating
│   └── invoicing/
├── lib/                      # pure, stateless helpers shared by services and routes
│   ├── db/                    # Drizzle client, query builders
│   └── webhooks/                # signature verification, idempotency check
└── middleware/                 # auth, error handling, rate limiting
```

Same dependency direction: routes → services → lib. A route handler never contains business logic directly — see `.claude/rules/backend-api.md` for the enforced version of this rule.

## `apps/mobile` — the same shape, thin-client flavor

```
apps/mobile/src/
├── features/                # same feature folders as web: clients/, invoices/, dashboard/
├── shared/
└── lib/                       # mostly re-exports from packages/types — no new business logic here
```

The rule that matters most here: `apps/mobile` has almost nothing in its own `lib/` beyond thin re-exports — real domain logic lives in `apps/api` and `packages/types`, not duplicated on-device. See `.claude/rules/mobile.md`.
