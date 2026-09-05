# Tasks — Core Invoicing

Depends on `identity-and-rbac`'s tasks (auth middleware, `workspace_members`) existing first — schema drives the feature, so this list assumes that schema/migration is already applied.

**Status: implemented and passing (67/67 tests, TypeScript strict, ESLint clean).** Checked off below; deviations from the original plan are noted inline.

## 1. Schema & migration (`packages/db`)
- [x] `packages/db/schema/invoicing.ts` — `clients`, `invoiceSequences`, `invoices`, `invoiceItems`, `payments`, `webhookEvents`, `reminderRules`, `reminderEvents`, `invoiceEvents`.
- [x] Migration generated and applied to the local test Postgres.
- [x] Default `reminderRules` (`[-3, 0, 3, 10]`) and a `FREE`/`ACTIVE` `subscriptions` row are both seeded in `identity-and-rbac`'s `signup()` — noted there, not duplicated.

## 2. Money arithmetic utility (`apps/api/src/lib/money/decimal.ts`)
- [x] `toDecimal`, `sum`, `multiply`, `toDbString`, `isGreaterThanOrEqual`, `isGreaterThanZero` — every money calculation goes through this, verified by a test using values chosen to break float arithmetic (three `100.10` payments summing to exactly `300.30`).

## 3. Invoice numbering (`services/invoicing/generate-invoice-number.ts`)
- [x] Transaction-safe `UPDATE ... RETURNING`, provisioned at `nextNumber: 0` so the first invoice comes out numbered 1.
- [x] Concurrency test: 20 simultaneous calls for one workspace → 20 unique sequential numbers. (Caught and fixed a real off-by-one bug during implementation — the initial version numbered the first invoice `0002`.)

## 4. Invoice state machine (`services/invoicing/status.ts`)
- [x] `TRANSITIONS` table + `assertTransition()`; `PARTIALLY_PAID`/`OVERDUE` cross-transitions included.
- [x] `recomputeStatusFromPayments()` — decimal-safe sum comparison.
- [x] Every legal/illegal transition pair tested, including the "cannot cancel PARTIALLY_PAID/PAID" rule.

## 5. Client service (`services/clients/clients.ts`)
- [x] `createClient()`, `listClients()`, `updateClient()`, `archiveClient()` — archive only, no hard-delete path exists.
- [x] Archived-client visibility and historical-invoice-survives-archiving both tested.

## 6. Invoice service (`services/invoicing/invoices.ts`)
- [x] `createInvoice()`, `updateInvoice()`/`deleteInvoice()` (DRAFT-only), `sendInvoice()`, `recordManualPayment()`, `cancelInvoice()`.
- **Deviation from plan**: `checkPlanLimit()` is a **real implementation** (pulled forward from `subscription-billing/design.md`), not a throwing stub — every workspace already gets a `FREE`/`ACTIVE` `subscriptions` row from `signup()`, so a permanent stub would have made every invoice/client creation fail. `subscription-billing`'s own pass still owns checkout/webhooks/billing routes.

## 7. Payment webhook handlers (`routes/webhooks.ts`, `services/payments/`)
- [x] Razorpay + Stripe handlers: signature verify → `webhookEvents` dedupe → payment insert → status recompute → cache invalidation → audit → SSE publish.
- [x] Signature verification implemented directly (HMAC-SHA256, no `stripe`/`razorpay` SDK dependency) and unit-tested without needing live credentials.
- [x] Redelivery tested (no duplicate `payments` row) and partial-payment-via-two-events tested.
- **Deviation**: `createRazorpayOrder()`/`createStripeCheckoutSession()` (the outbound "create a payment link" calls) are documented boundaries that throw if actually invoked — they require live provider credentials this environment doesn't have. Webhook *receiving* is fully implemented and tested; webhook *triggering* (checkout initiation) is not.

## 8. SSE (`lib/sse.ts`, `routes/events.ts`)
- [x] `GET /events` — same `authenticate`/`resolveWorkspace`/`requireRole` chain as any other route.
- [x] In-memory per-instance connection map with the documented single-instance limitation.
- [x] Publish helper wired into both the webhook handlers and `mark-overdue-invoices`.

## 9. PDF & email (`services/invoicing/pdf.ts`)
- [x] PDF generation via `pdfkit` — business/client details, line items, totals, currency.
- **Deviation**: email sending remains the `lib/email.ts` console-log stub (same as `identity-and-rbac`) — real SES wiring and `packages/email-templates` content are still a follow-up. The generated PDF buffer isn't yet attached/stored since there's no real email transport to attach it to.

## 10. Scheduled jobs (`jobs/`)
- [x] `mark-overdue-invoices` and `send-reminders` written as plain, directly-testable functions (not hidden inside a BullMQ processor), with a thin `jobs/scheduler.ts` wiring them to daily repeatable BullMQ jobs for the real running process.
- [x] Free-plan skip, dedupe-via-unique-constraint, and the "only SENT/OVERDUE/PARTIALLY_PAID are reminder-eligible" rule all tested.

## 11. Dashboard summary (`services/dashboard/summary.ts`, `routes/dashboard.ts`)
- [x] Grouped-by-currency aggregation done in SQL (`SUM` on `NUMERIC` is exact — no need to pull rows into JS for decimal.js), Redis-cached at 60s TTL.

## 12. Routes wiring (`routes/clients.ts`, `routes/invoices.ts`)
- [x] All routes wired with `requireRole(...)` per the domain skill's RBAC table.
- [x] Zod schemas added to `packages/types/src/invoicing.ts` — decimal amounts validated as regex-checked strings, never accepted as JS numbers.
- **Note for frontend implementation**: these routes aren't nested under `/workspaces/:id/...`, so the active workspace is read from an `x-workspace-id` header (see `resolve-workspace.ts`) — the frontend must send this once a workspace is selected.

## 13. Tests
- [x] All cross-cutting tests from the original plan present and passing, plus the RBAC-denial suite (`routes/invoicing-rbac.test.ts`) covering every MEMBER-restricted action (delete client, delete invoice, cancel invoice) alongside the MEMBER-permitted ones (create client, send invoice, mark paid).

## Explicit non-tasks here (unchanged)
Frontend UI, recurring invoices, custom branding/templates, client portal, subscription billing's checkout/webhook/billing-routes — separate specs/work, not built here.
