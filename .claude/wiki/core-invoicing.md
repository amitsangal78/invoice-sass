# Core Invoicing

## Purpose

Clients, invoices, payments, and the money/status logic that has to be exactly right — this is the domain with the least tolerance for a subtle bug (financial correctness, not just UX).

## Money arithmetic — the one rule that matters most

Every money calculation (line totals, subtotal, tax, discount, total, cumulative-payments-vs-total) goes through `decimal.js` (`apps/api/src/lib/money/decimal.ts`), never raw `+`/`*` on a JS `number`. Convert to `string` at the Drizzle boundary (Postgres `NUMERIC` round-trips as a string), to `Decimal` for computation, back to `string` to persist. `item.quantity * item.unitPrice` done directly anywhere is a bug at the same severity as a missing tenant-scope filter — flag it that seriously in review.

## Invoice state machine (`apps/api/src/services/invoicing/status.ts`)

```
DRAFT → SENT | CANCELLED
SENT → PARTIALLY_PAID | PAID | OVERDUE | CANCELLED
PARTIALLY_PAID → PAID
OVERDUE → PARTIALLY_PAID | PAID
PAID, CANCELLED → (terminal)
```
Every status write goes through `setInvoiceStatus`/`assertTransition` — no route or job sets `invoices.status` via a raw update. `recomputeStatusFromPayments()` (called after any payment insert, webhook or manual) decides `PARTIALLY_PAID` vs `PAID` from `sum(payments.amount)` vs `invoices.total` via `decimal.js`, then calls the checked setter.

## Invoice numbering

`generateInvoiceNumber()` does `UPDATE invoice_sequences SET next_number = next_number + 1 ... RETURNING`, inside the same transaction as the `invoices` INSERT — the single-row-per-workspace `UPDATE ... RETURNING` is what makes concurrent creation safe (Postgres serializes the row lock), not application-level locking. **Provisioning gotcha**: see [mistakes.md](mistakes.md) — a workspace's `invoice_sequences` row must be inserted with `nextNumber: 0`, not the column's own default of `1`.

## Editability window

`updateInvoice`/`deleteInvoice` only allow changes while `status === 'DRAFT'` (409 `invoice_not_draft` otherwise). This is *why* the PDF cache (below) can safely live for 15 days — a non-DRAFT invoice's rendered content is provably immutable, not just unlikely to change.

## PDF generation & caching

`services/invoicing/pdf.ts`'s `generateInvoicePdf()` renders the PDF (pdfkit) from an invoice + client + its line items. `services/invoicing/invoices.ts`'s `getInvoicePdf(workspaceId, invoiceId)` wraps that: 409s if still `DRAFT`, otherwise cache-asides through Redis (`lib/redis.ts`'s `cacheAside`, key `workspace:{workspaceId}:invoice:{invoiceId}:pdf`, 15-day TTL, base64 in/out). The long TTL is justified by immutability, not by cost. Route: `GET /invoices/:id/pdf` — the one deliberate exception to the `{ data }` JSON envelope (`rules/backend-api.md`), served through `apps/web`'s `app/api/invoices/[id]/pdf/route.ts` proxy so the browser gets it same-origin without the auth token reaching client JS.

**Documented gap**: `core-invoicing/design.md` scopes this route to `ADMIN, MEMBER, and USER (own invoice only)` — the `USER` (client-portal) side isn't implemented yet, only the tenant side. See [client-portal.md](client-portal.md).

## Dashboard aggregates

`services/dashboard/summary.ts`'s `getDashboardSummary()` returns everything the dashboard renders in one payload — they share a single Redis entry (`workspace:{id}:dashboard`, 60s) and a single page consumes them, so splitting them into separate endpoints would just multiply round-trips and cache keys.

- `outstanding` / `paid` / `overdue` / `dueSoon` — invoice totals **grouped by currency, never summed across currencies**. `dueSoon` is `SENT` and falling due within 7 days, deliberately excluding `OVERDUE` (that's its own card).
- `paidThisMonth` — derived from `payments.paidAt`, **not** from `invoices.status`. An invoice being `PAID` says nothing about *when* the money arrived; using status here would attribute an old payment to the current month.
- `revenueTrend` — payments bucketed by month for 6 months, per currency. The UI renders only the dominant currency: bars of different currencies can't share a y-axis without implying an exchange rate, and this product has no conversion engine by design.
- `recentPayments` — joined through `invoices` → `clients` for the client name.

`listInvoices()` also joins `clients` so list views get a name without an N+1 per row. All of it stays workspace-scoped exactly as before; `summary.test.ts` covers each aggregate plus a cross-workspace isolation case.

## Payment webhooks

`POST /webhooks/{razorpay,stripe}`: verify signature → check `webhook_events` for `providerEventId` (redelivery no-ops, 200) → insert `webhook_events` + `payments` + recompute status, all in one transaction (a crash mid-way must never leave the dedupe row inserted but the payment missing — that would make a real redelivery look like a duplicate and silently drop money) → invalidate the Redis `workspace:{id}:invoice:{id}` and `workspace:{id}:dashboard` keys → publish SSE `invoice.updated`.

## SSE

`GET /events`, workspace-scoped, goes through the normal `authenticate`+`resolveWorkspace` chain (no security exemption for real-time). In-memory `workspaceId → Set<Response>` map **per API instance** — a client on instance A won't see an event from instance B behind a multi-instance ALB. Accepted as a known limitation (a missed live update just means a stale view until next refresh, not a correctness bug), not revisited unless it actually bothers users in practice.

## Scheduled jobs (BullMQ)

- `mark-overdue-invoices` (daily): `SENT` + past `dueDate` → `OVERDUE`, via the checked setter.
- `send-reminders` (daily): per workspace's `reminder_rules`, matches by `offsetDays`, skips if a `reminder_events` row already exists for that `(invoiceId, ruleId)` — the unique constraint is the real guarantee, the query is an optimization. Skips Free-plan workspaces (calls [subscription-billing.md](subscription-billing.md)'s `checkPlanLimit`).

## Key files

- Schema: `packages/db/src/schema/invoicing.ts` — `clients`, `invoiceSequences`, `invoices`, `invoiceItems`, `payments`, `webhookEvents`, `reminderRules`, `reminderEvents`, `invoiceEvents`.
- Services: `apps/api/src/services/invoicing/{invoices,status,generate-invoice-number,pdf,receipts}.ts`.
- Payments: `apps/api/src/services/payments/{process-webhook,providers/{razorpay,stripe}}.ts`.
- Routes: `apps/api/src/routes/{clients,invoices,webhooks,dashboard,events}.ts`.
- Jobs: `apps/api/src/jobs/{mark-overdue-invoices,send-reminders}.ts`.
- Consumed by: `apps/web` (`clients`, `invoices`, `dashboard` pages), `apps/mobile` (`clients`, `invoices` tabs).

## Invariants

- Client delete is always archive (`clients.archivedAt`), never a real delete — historical invoices must keep referencing a real client row.
- Every query touching `clients`/`invoices`/`invoice_items` filters by `workspace_id` resolved server-side — never trust a client-supplied workspace id.
