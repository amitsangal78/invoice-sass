# Design — Core Invoicing

> Builds on the approved `requirements.md` and `identity-and-rbac/design.md`
> (auth/RBAC middleware, `workspace_members`). Resolved decisions below;
> `tasks.md` follows.

## Resolved decisions

| Open item | Decision | Why |
|---|---|---|
| Client delete behavior | **Always archive (soft-delete), never a true delete endpoint.** `clients.archivedAt` timestamp, nullable. Archived clients are hidden from default lists/pickers but remain fully intact for historical invoice references, reports, and the client portal (an archived client's existing invoices are unaffected). | Simpler than a two-path "block if invoices exist, else hard-delete" rule — one behavior, no edge case where a client with zero invoices today can be hard-deleted, then a backdated/imported invoice later references a client id that no longer exists. Matches the "prefer soft-delete" call made earlier. |
| Dependency on `identity-and-rbac` | Confirmed — every route below composes `authenticate`, `resolveWorkspace`, `requireRole` from that spec's middleware. Nothing here re-implements auth. | |
| Currency handling | Confirmed sufficient as specified — per-invoice `currency`, no conversion, grouped reporting. | |

## Data model (Drizzle schema shape)

```ts
// packages/db/schema/invoicing.ts

export const invoiceStatusEnum = pgEnum('invoice_status', ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']);
export const paymentSourceEnum = pgEnum('payment_source', ['WEBHOOK', 'MANUAL']);
export const invoiceEventTypeEnum = pgEnum('invoice_event_type', [
  'INVOICE_CREATED', 'INVOICE_UPDATED', 'INVOICE_SENT', 'INVOICE_MARKED_PAID',
  'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'INVOICE_CANCELLED', 'REMINDER_SENT',
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'MEMBER_INVITED', 'ROLE_CHANGED', 'WORKSPACE_UPDATED', 'TENANT_DATA_VIEWED',
]);

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  billingAddress: text('billing_address'),
  archivedAt: timestamp('archived_at'),          // soft-delete — see "Resolved decisions"
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ workspaceIdx: index('clients_workspace_id_idx').on(t.workspaceId) }));

export const invoiceSequences = pgTable('invoice_sequences', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  prefix: text('prefix').notNull().default('INV'),
  nextNumber: integer('next_number').notNull().default(1),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  invoiceNumber: text('invoice_number').notNull(),          // e.g. "INV-2026-0007"
  status: invoiceStatusEnum('status').notNull().default('DRAFT'),
  currency: text('currency').notNull(),                     // ISO 4217, e.g. "INR"
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  dueDate: date('due_date').notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('invoices_workspace_id_idx').on(t.workspaceId),
  statusIdx: index('invoices_status_idx').on(t.status),
  dueDateIdx: index('invoices_due_date_idx').on(t.dueDate),
  uniqueNumberPerWorkspace: unique('invoices_workspace_number_unique').on(t.workspaceId, t.invoiceNumber),
}));

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),   // quantity * unitPrice, stored not derived
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  source: paymentSourceEnum('source').notNull(),           // WEBHOOK | MANUAL
  providerReference: text('provider_reference'),            // Razorpay/Stripe payment id, null for MANUAL
  recordedBy: uuid('recorded_by').references(() => users.id),  // set for MANUAL, null for WEBHOOK
  paidAt: timestamp('paid_at').notNull().defaultNow(),
}, (t) => ({ invoiceIdx: index('payments_invoice_id_idx').on(t.invoiceId) }));

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerEventId: text('provider_event_id').notNull().unique(),
  provider: text('provider').notNull(),          // 'razorpay' | 'stripe'
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
});

export const reminderRules = pgTable('reminder_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  offsetDays: integer('offset_days').notNull(),   // negative = before due date, positive = after (overdue)
  isEnabled: boolean('is_enabled').notNull().default(true),
}, (t) => ({ workspaceIdx: index('reminder_rules_workspace_id_idx').on(t.workspaceId) }));
// seeded defaults per workspace on creation: [-3, 0, 3, 10] — before-due, on-due, +3d overdue, +10d overdue

export const reminderEvents = pgTable('reminder_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').notNull().references(() => reminderRules.id),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
}, (t) => ({
  uniquePerInvoiceRule: unique('reminder_events_invoice_rule_unique').on(t.invoiceId, t.ruleId),
}));

export const invoiceEvents = pgTable('invoice_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),   // nullable — some event types (LOGIN_*) aren't workspace-scoped
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  userId: uuid('user_id').references(() => users.id),
  event: invoiceEventTypeEnum('event').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('invoice_events_workspace_id_idx').on(t.workspaceId),
  invoiceIdx: index('invoice_events_invoice_id_idx').on(t.invoiceId),
}));
```

`webhookEvents` and `invoiceEvents` are defined here (this is the first spec that needs their full shape); `identity-and-rbac`'s auth events (`LOGIN_SUCCESS` etc.) reuse this same `invoiceEvents` table, per that spec's design.

## Money arithmetic — a concrete rule, not just "use NUMERIC"

Postgres `NUMERIC` prevents float drift at rest, but **JavaScript's native `number` still can't safely do the arithmetic** before a value is persisted (0.1 + 0.2 problems apply equally to ₹). Rule: every money calculation in `services/invoicing/` (line totals, subtotal, tax, discount, total, cumulative-payments-vs-total comparison for the `PARTIALLY_PAID`/`PAID` decision) goes through a decimal-safe library (`decimal.js`), never raw `+`/`*` on `number`. Convert to/from `string` at the Drizzle boundary (NUMERIC columns round-trip as strings), convert to `Decimal` for any computation, convert back to `string` to persist. A route or component doing `item.quantity * item.unitPrice` directly is a bug, not a style nit — flag it in review the same weight as a missing tenant-scope filter.

## Invoice numbering

```ts
// services/invoicing/generate-invoice-number.ts
async function generateInvoiceNumber(workspaceId: string, tx: Transaction): Promise<string> {
  const [seq] = await tx.update(invoiceSequences)
    .set({ nextNumber: sql`${invoiceSequences.nextNumber} + 1` })
    .where(eq(invoiceSequences.workspaceId, workspaceId))
    .returning();
  const year = new Date().getFullYear();
  return `${seq.prefix}-${year}-${String(seq.nextNumber).padStart(4, '0')}`;
}
```
Called inside the same transaction as the `invoices` INSERT — the `UPDATE ... RETURNING` on a single-row-per-workspace table is what makes concurrent invoice creation safe (Postgres serializes the row lock), not application-level locking.

## Invoice state machine (`services/invoicing/status.ts`)

```ts
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID'],          // can also implicitly stay PARTIALLY_PAID on further partial payment
  OVERDUE: ['PARTIALLY_PAID', 'PAID'],
  PAID: [],
  CANCELLED: [],
};

function assertTransition(from: InvoiceStatus, to: InvoiceStatus) {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidStatusTransitionError(from, to);
}
```
Every status write in the codebase goes through a function that calls `assertTransition` first — no route or job sets `invoices.status` via a raw update. `recomputeStatusFromPayments(invoiceId)` (called after any payment insert) computes `PARTIALLY_PAID` vs `PAID` from `sum(payments.amount) vs invoices.total` using `decimal.js`, then calls the transition-checked setter.

## API routes (`apps/api/src/routes/`)

All routes below are composed with `authenticate, resolveWorkspace` from `identity-and-rbac`, plus `requireRole(...)` as noted.

| Route | Roles | Notes |
|---|---|---|
| `POST /clients` | ADMIN, MEMBER | |
| `GET /clients` | ADMIN, MEMBER | excludes archived by default; `?includeArchived=true` for the archive view |
| `PATCH /clients/:id` | ADMIN, MEMBER | |
| `DELETE /clients/:id` | ADMIN | sets `archivedAt`, never a real delete |
| `POST /invoices` | ADMIN, MEMBER | creates `DRAFT`; plan-limit check before insert (calls `subscription-billing`'s limits service — stubbed/throws-not-implemented until that spec lands) |
| `GET /invoices`, `GET /invoices/:id` | ADMIN, MEMBER | |
| `PATCH /invoices/:id` | ADMIN, MEMBER | only while `DRAFT` |
| `DELETE /invoices/:id` | ADMIN | only while `DRAFT` |
| `POST /invoices/:id/send` | ADMIN, MEMBER | `DRAFT → SENT`; generates PDF, sends email, sets `sentAt` |
| `POST /invoices/:id/mark-paid` | ADMIN, MEMBER | manual payment; inserts a `payments` row with `source: MANUAL`, `recordedBy: req.user.id` |
| `POST /invoices/:id/cancel` | ADMIN | only from `DRAFT`/`SENT` |
| `GET /invoices/:id/pdf` | ADMIN, MEMBER, and `USER` (own invoice only — see `client-portal`) | |
| `GET /dashboard/summary` | ADMIN, MEMBER | grouped-by-currency aggregate, Redis-cached (`workspace:{id}:dashboard`, TTL 30–120s) |
| `GET /events` (SSE) | ADMIN, MEMBER | see below |
| `POST /webhooks/razorpay`, `POST /webhooks/stripe` | none (signature-verified instead) | public, rate-limited |

## Payment webhook handling

```
POST /webhooks/razorpay
  → verify Razorpay signature (reject 400 before touching the body otherwise)
  → check webhookEvents for providerEventId → if found, 200 no-op (redelivery)
  → INSERT webhookEvents row
  → look up invoice by provider's order/payment reference
  → INSERT payments (source: WEBHOOK, providerReference: ...)
  → recomputeStatusFromPayments(invoiceId)   // → PARTIALLY_PAID or PAID via the checked transition
  → invalidate Redis workspace:{id}:invoice:{invoiceId} and workspace:{id}:dashboard
  → INSERT invoiceEvents (PAYMENT_RECEIVED)
  → publish SSE invoice.updated to the workspace's connected clients
  → 200
```
Steps "insert webhookEvents" through "recompute status" run in one transaction — a crash between them must not leave the dedupe row inserted but the payment missing (which would make a real redelivery look like a duplicate and silently drop the payment).

## SSE (`GET /invoices` real-time channel)

- One endpoint, `GET /events`, workspace-scoped (goes through `authenticate` + `resolveWorkspace` like any other route — SSE doesn't get a security exemption).
- Server holds an in-memory map of `workspaceId → Set<Response>` per API instance. Since the API runs multiple instances behind an ALB (`tech.md`), a client connected to instance A won't see an event published by a webhook handled on instance B — **acceptable for this feature** (a missed live update just means the user sees it on next poll/refresh, not a correctness bug), but explicitly note this as a known limitation rather than an oversight. Revisit with a Redis pub/sub fan-out only if this gap actually bothers users in practice.
- Event payload: `{ event: 'invoice.updated' | 'invoice.paid' | 'payment.received' | 'reminder.sent', invoiceId, status }` — client refetches the specific invoice/dashboard on receipt rather than trusting the SSE payload as the full state (SSE is a "something changed, go refetch" signal, not a state-sync protocol).

## Scheduled jobs (BullMQ repeatable)

- `mark-overdue-invoices` (daily): `SENT` invoices past `dueDate` → transition to `OVERDUE` via the checked setter, write `invoice_events`... this is a **status transition**, not a reminder send, so it's separate from the job below even though both run on a schedule.
- `send-reminders` (daily): for each workspace's enabled `reminder_rules`, find invoices matching the offset, skip any with an existing `reminder_events` row for that `(invoiceId, ruleId)` pair (the unique constraint is the actual guarantee; the query is an optimization, not the source of correctness), send email, insert `reminder_events`, insert `invoice_events` (`REMINDER_SENT`). Skips workspaces on the Free plan (calls `subscription-billing`'s plan-check, same stub-until-that-spec-lands note as invoice creation above).

## Testing requirements for this spec

- Invoice numbering under concurrency: fire N simultaneous `createInvoice` calls for one workspace, assert N unique sequential numbers — this is the one bug class as important as the webhook redelivery test.
- State machine: every illegal transition in the `TRANSITIONS` table rejected, every legal one succeeds.
- `recomputeStatusFromPayments`: partial payment → `PARTIALLY_PAID`; cumulative meets/exceeds total → `PAID`; uses `decimal.js` comparison, tested with values that would misbehave under float arithmetic (e.g. repeated `0.1`-equivalent paise amounts).
- Webhook redelivery: same `providerEventId` twice → second call is a no-op, no duplicate `payments` row.
- Client archive: archived client disappears from default `GET /clients`, its historical invoices remain fully readable.
- RBAC: MEMBER blocked from `DELETE /clients/:id`, `DELETE /invoices/:id`, `POST /invoices/:id/cancel`, `POST /invoices/:id/mark-unpaid`-equivalent — cross-reference the RBAC table in the domain skill, don't just test the happy path per route.
