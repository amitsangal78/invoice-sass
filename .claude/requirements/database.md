# Database Layer — Postgres, Redis, Bloom Filter — Functional & Non-Functional Requirements

Cross-reference: `steering/tech.md` (Redis conventions, Bloom filter rules, currency handling), `skills/invoice-reminder-saas-domain` (full table list, state machine).

## Functional requirements — Postgres (Neon)

### Core tables (see the domain skill for the authoritative, evolving list)
```
users, refresh_tokens, email_verification_tokens, password_reset_tokens
workspaces, workspace_members, workspace_invitations
clients, client_users
invoices, invoice_items, invoice_sequences
payments
subscriptions
webhook_events
reminder_rules, reminder_events
invoice_events (audit trail)
```

### Constraints & integrity
- Foreign keys between every child table and its parent (`invoices.workspace_id → workspaces.id`, etc.) — no orphaned rows by convention alone.
- Unique constraints: `webhook_events.provider_event_id`, `(workspace_id, invoice_number)` on `invoices`, `(user_id, workspace_id)` on `workspace_members`.
- Check constraints on `invoices.status` and `payments` amounts (non-negative).
- All monetary columns `NUMERIC`/`DECIMAL` — never `float` or `double precision`.
- Multi-currency: `invoices.currency` per row; no conversion table, no cross-currency aggregation at the query level — reporting groups by currency (see `tech.md`).

### Transactions
- Webhook processing: signature verify → `webhook_events` dedupe insert → update `payments` + `invoices.status`, in one transaction where the driver allows it — no code path may leave `payments` and `invoices.status` inconsistent.
- Invoice numbering: increment `invoice_sequences` and create the `invoices` row under a lock/transaction — concurrent invoice creation must never produce a duplicate number.

## Functional requirements — Redis

See `tech.md`'s "Redis conventions" section for the authoritative key-naming/TTL rules. Functional roles:
- **Caching**: workspace settings, permissions, dashboard summary, invoice detail — all keyed with `workspace:{workspaceId}:...`.
- **Rate limiting**: login attempts, password-reset attempts, public payment-link access, general API abuse.
- **Idempotency**: short-lived keys for payment creation and webhook processing (e.g. `idempotency:razorpay:{eventId}`) — a fast-path companion to the durable `webhook_events` table, not a replacement for it.
- **Ephemeral workflow state**: optional, for short-lived flows — long-term security records (verification tokens, reset tokens) still persist in Postgres.

## Functional requirements — Bloom filter

Selective use only — see `tech.md` for the full rule set. In scope: negative-lookup optimization for public invoice ids, portal tokens, high-volume webhook-event-id checks. Out of scope, permanently: any authorization decision.

## Non-functional requirements

| Category | Requirement |
|---|---|
| Source of truth | Postgres (Neon) is authoritative for everything. Redis is cache/ephemeral state; if it's unavailable, the app degrades in performance, never in correctness — every Redis read has a Postgres fallback path. |
| Tenant isolation | Every Postgres query touching a tenant-owned table filters by `workspace_id`, resolved server-side from the caller's session — never a client-supplied value taken at face value. Every Redis key touching tenant data includes the workspace id (`workspace:{id}:...`, never a bare `invoice:{id}`). |
| Cache correctness | TTL defined per cache type (settings ~10–30 min, dashboard ~30–120 sec, permissions ~5–15 min, invoice detail ~1–5 min — tune later, don't ship undefined). Invalidate/update on the same request path as the mutation that changed the underlying data, not via a lagging sweep. |
| Bloom filter safety | False positives (「possibly exists」) always re-verified against Redis/Postgres before acting; a false negative is prevented by keeping the filter correctly rebuilt from Postgres (on restart/deploy, with a rebuild/versioning strategy) — never trusted blindly forever. If the filter is down, skip it; correctness never depends on it. |
| Performance | Indexes on `workspace_id`, `user_id`, `client_id`, `invoice_id`, `email`, `status`, `due_date`, `created_at` at minimum. Avoid N+1 queries; use connection pooling; minimize AWS↔Neon round trips. |
| Security | No plain passwords, JWT signing secrets, or card data stored in Postgres or Redis. Refresh/verification/reset tokens stored **hashed**, never plaintext. |
| Backup/DR | Neon point-in-time recovery/branching; confirm an explicit retention window (7-day minimum) rather than assuming the platform default. RTO/RPO ⚠️ not yet defined. |
| Migrations | Additive, one logical change per migration, run as a gated CI step before the new API image goes live — never inside app startup code (`rules/backend-api.md`). |

## Shared authorization model (for reference — the actual logic lives in `apps/api`)

```
JWT → user → workspace → membership → role → permission → resource ownership → operation
```

Redis can accelerate parts of this chain (membership/permission lookup), but Postgres remains authoritative at every step — a cache-hit "allow" is never trusted if it can't be traced back to a Postgres row.
