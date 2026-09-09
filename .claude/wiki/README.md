# OpenWiki

Current-state system reference, meant to be read **before** changing code in a domain — not a substitute for `.claude/specs/` (which captures *why* a decision was made, historically, requirements → design → tasks) but a fast "how does this actually work right now" companion to it.

## Pages

| Page | Covers |
|---|---|
| [identity-and-rbac.md](identity-and-rbac.md) | Auth, JWT, workspace membership, RBAC, invitations |
| [core-invoicing.md](core-invoicing.md) | Clients, invoices, payments, status machine, reminders, PDF/Memcached |
| [client-portal.md](client-portal.md) | Magic-link auth, client-facing routes, isolation |
| [subscription-billing.md](subscription-billing.md) | Plans, plan limits, subscription webhooks |
| [infrastructure.md](infrastructure.md) | Local dev topology — ports, env vars, the multi-Postgres story |
| [mistakes.md](mistakes.md) | Real bugs hit during this build, so they aren't repeated |

See also: [`.claude/graph/functionality-graph.md`](../graph/functionality-graph.md) — a compact map of what depends on/is consumed by what, for orienting on a change that spans domains without re-reading the whole repo.

## The convention (see `.claude/rules/ai-context-workflow.md`)

1. **Before** touching a domain: read its wiki page, the relevant slice of the functionality graph, and `mistakes.md`.
2. **After** a nontrivial change, or fixing a bug whose root cause wasn't obvious: update the wiki page and, for a real mistake, append an entry to `mistakes.md`.

This is maintained documentation, not generated — it drifts if it isn't kept honest. A wiki page that no longer matches the code is worse than no wiki page; fix it in the same pass as the code change that made it stale.
