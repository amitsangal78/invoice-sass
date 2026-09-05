import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity';

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);
export const paymentSourceEnum = pgEnum('payment_source', ['WEBHOOK', 'MANUAL']);
export const invoiceEventTypeEnum = pgEnum('invoice_event_type', [
  'INVOICE_CREATED',
  'INVOICE_UPDATED',
  'INVOICE_SENT',
  'INVOICE_MARKED_PAID',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'INVOICE_CANCELLED',
  'REMINDER_SENT',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'MEMBER_INVITED',
  'ROLE_CHANGED',
  'WORKSPACE_UPDATED',
  'TENANT_DATA_VIEWED',
]);

export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type PaymentSource = (typeof paymentSourceEnum.enumValues)[number];
export type InvoiceEventType = (typeof invoiceEventTypeEnum.enumValues)[number];

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    billingAddress: text('billing_address'),
    // soft-delete only — see core-invoicing/design.md "Resolved decisions"; there is no hard-delete path
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clients_workspace_id_idx').on(t.workspaceId)],
);

export const invoiceSequences = pgTable('invoice_sequences', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prefix: text('prefix').notNull().default('INV'),
  nextNumber: integer('next_number').notNull().default(1),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    invoiceNumber: text('invoice_number').notNull(), // e.g. "INV-2026-0007"
    status: invoiceStatusEnum('status').notNull().default('DRAFT'),
    currency: text('currency').notNull(), // ISO 4217, e.g. "INR"
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    dueDate: date('due_date').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_workspace_id_idx').on(t.workspaceId),
    index('invoices_status_idx').on(t.status),
    index('invoices_due_date_idx').on(t.dueDate),
    unique('invoices_workspace_number_unique').on(t.workspaceId, t.invoiceNumber),
  ],
);

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  // quantity * unitPrice, stored — not derived on read, so historical invoices don't drift
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    source: paymentSourceEnum('source').notNull(),
    providerReference: text('provider_reference'), // Razorpay/Stripe payment id; null for MANUAL
    recordedBy: uuid('recorded_by').references(() => users.id), // set for MANUAL, null for WEBHOOK
    // set once at payment-confirmation time — see client-portal/design.md
    receiptNumber: text('receipt_number'),
    receiptUrl: text('receipt_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_invoice_id_idx').on(t.invoiceId)],
);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerEventId: text('provider_event_id').notNull().unique(),
  provider: text('provider').notNull(), // 'razorpay' | 'stripe'
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reminderRules = pgTable(
  'reminder_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // negative = before due date, positive = after (overdue); seeded defaults [-3, 0, 3, 10]
    offsetDays: integer('offset_days').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
  },
  (t) => [index('reminder_rules_workspace_id_idx').on(t.workspaceId)],
);

export const reminderEvents = pgTable(
  'reminder_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => reminderRules.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('reminder_events_invoice_rule_unique').on(t.invoiceId, t.ruleId)],
);

export const invoiceEvents = pgTable(
  'invoice_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // nullable — some event types (LOGIN_*) aren't workspace-scoped
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    userId: uuid('user_id').references(() => users.id),
    event: invoiceEventTypeEnum('event').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invoice_events_workspace_id_idx').on(t.workspaceId), index('invoice_events_invoice_id_idx').on(t.invoiceId)],
);
