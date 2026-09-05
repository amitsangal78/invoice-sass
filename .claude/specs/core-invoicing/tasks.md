# Tasks — Core Invoicing

Depends on `identity-and-rbac`'s tasks (auth middleware, `workspace_members`) existing first — schema drives the feature, so this list assumes that schema/migration is already applied.

## 1. Schema & migration (`packages/db`)
- [ ] Write `packages/db/schema/invoicing.ts` — `clients`, `invoiceSequences`, `invoices`, `invoiceItems`, `payments`, `webhookEvents`, `reminderRules`, `reminderEvents`, `invoiceEvents` per `design.md`.
- [ ] Generate + review migration, apply to local test Postgres.
- [ ] Seed default `reminderRules` (`[-3, 0, 3, 10]`) on workspace creation — add this as a follow-up to `identity-and-rbac`'s `signup()` (that service now has a second responsibility; note it there when implementing, don't silently duplicate workspace-creation logic here).

## 2. Money arithmetic utility (`apps/api/src/lib/money/`) — depends on nothing above
- [ ] Thin wrapper around `decimal.js`: `toDecimal(numericString)`, `sum(...)`, `compare(...)`, `toDbString(decimal)`. Every service below imports this instead of touching `Decimal` directly, so the DB round-trip (`string ↔ Decimal`) happens in one place.

## 3. Invoice numbering (`services/invoicing/generate-invoice-number.ts`) — depends on 1
- [ ] Transaction-safe `UPDATE ... RETURNING` implementation per `design.md`.
- [ ] Concurrency test: N simultaneous calls for one workspace produce N unique sequential numbers.

## 4. Invoice state machine (`services/invoicing/status.ts`) — depends on 1, 2
- [ ] `TRANSITIONS` table + `assertTransition()`.
- [ ] `recomputeStatusFromPayments(invoiceId)` — decimal-safe sum comparison.
- [ ] Test every legal/illegal transition pair.

## 5. Client service (`services/clients/`) — depends on 1
- [ ] `createClient()`, `listClients()` (excludes archived by default), `updateClient()`, `archiveClient()` (ADMIN-only, sets `archivedAt` — never a real delete).
- [ ] Test: archived client hidden from default list, its invoices remain readable.

## 6. Invoice service (`services/invoicing/`) — depends on 2, 3, 4, 5
- [ ] `createInvoice()` — validates ≥1 line item + currency, computes subtotal/tax/discount/total via the money utility, calls invoice-numbering, inserts `invoices` + `invoiceItems` in one transaction, checks plan limits (stub a `checkPlanLimit()` call that throws `NotImplementedError` until `subscription-billing` lands — never silently skip the check).
- [ ] `updateInvoice()` / `deleteInvoice()` — `DRAFT`-only, enforced here even though the route also restricts by role.
- [ ] `sendInvoice()` — `DRAFT → SENT` via the checked setter, generates PDF (task 9), sends email, sets `sentAt`, writes `INVOICE_SENT` event.
- [ ] `recordManualPayment()` — inserts `payments` with `source: MANUAL`, calls `recomputeStatusFromPayments`.
- [ ] `cancelInvoice()` — rejects outside `DRAFT`/`SENT`.

## 7. Payment webhook handlers (`routes/webhooks/`) — depends on 4, 6
- [ ] `POST /webhooks/razorpay` — signature verify → `webhookEvents` dedupe → insert `payments` (`source: WEBHOOK`) → `recomputeStatusFromPayments` → cache invalidation → `invoice_events` → SSE publish, all per `design.md`'s ordering, dedupe-insert and payment-insert in one transaction.
- [ ] `POST /webhooks/stripe` — same shape, Stripe's signature scheme.
- [ ] Redelivery test: same `providerEventId` twice → second call no-ops, no duplicate `payments` row.

## 8. SSE (`routes/events.ts`) — depends on 1 (identity-and-rbac's middleware)
- [ ] `GET /events` — `authenticate` + `resolveWorkspace`, holds the in-memory `workspaceId → Set<Response>` map, documented single-instance limitation per `design.md`.
- [ ] Publish helper called from the webhook handlers (task 7) and the scheduled jobs (task 10).

## 9. PDF & email (`services/invoicing/pdf.ts`, `packages/email-templates/`) — depends on 6
- [ ] PDF generation: business details, client details, invoice number, dates, line items, tax, discount, total, currency, logo.
- [ ] Invoice email template + send call (SES).

## 10. Scheduled jobs (BullMQ) — depends on 4, 6
- [ ] `mark-overdue-invoices` (daily) — `SENT` + past due → `OVERDUE` via the checked setter.
- [ ] `send-reminders` (daily) — per-workspace `reminderRules`, dedupe via the `(invoiceId, ruleId)` unique constraint, skip Free-plan workspaces (same stub-until-`subscription-billing` note as task 6).

## 11. Dashboard summary (`routes/dashboard.ts`) — depends on 6
- [ ] `GET /dashboard/summary` — grouped-by-currency aggregate query, Redis-cached (`workspace:{id}:dashboard`, 30–120s TTL), invalidated by the same triggers as invoice cache (create/update/payment/cancel).

## 12. Routes wiring (`routes/clients.ts`, `routes/invoices.ts`) — depends on 5, 6, 11
- [ ] Wire every route in `design.md`'s table with the correct `requireRole(...)` per the domain skill's RBAC table.
- [ ] Zod schemas in `packages/types` for every request/response — shared with the eventual frontend forms.

## 13. Tests — cross-cutting, one per item called out in `design.md`
- [ ] Invoice numbering concurrency (task 3 covers the implementation; this is the explicit test artifact).
- [ ] State machine legal/illegal transitions (task 4).
- [ ] `recomputeStatusFromPayments` with values chosen to catch float-arithmetic bugs specifically (not just round numbers).
- [ ] Webhook redelivery (task 7).
- [ ] RBAC denial across every MEMBER-restricted route (delete client, delete invoice, cancel invoice, mark-unpaid-equivalent).

## Explicit non-tasks here
Frontend UI (invoice list/detail/create screens, dashboard) — separate work once this API exists. Recurring invoices, custom branding/templates, client portal, subscription billing — separate specs, not tasks here.
