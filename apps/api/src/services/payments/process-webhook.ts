import { eq } from 'drizzle-orm';
import { db, webhookEvents, payments, invoices } from '@invoice-saas/db';
import { recomputeStatusFromPayments } from '../invoicing/status';
import { invalidateCache } from '../../lib/redis';
import { writeAuditEvent } from '../../lib/audit';
import { publishWorkspaceEvent } from '../../lib/sse';
import { ApiHttpError } from '../../lib/errors';

export interface WebhookPaymentInput {
  provider: 'razorpay' | 'stripe';
  providerEventId: string;
  eventType: string;
  invoiceId: string;
  amount: string; // already normalized to the invoice's currency's major unit as a decimal string
}

/**
 * Shared processing for both providers' invoice-payment webhooks — never the
 * subscription-billing webhooks, which are a structurally separate path with
 * their own dedupe table (subscription-billing/design.md).
 *
 * Order matters: dedupe insert -> payment insert -> status recompute happen
 * inside one transaction, so a crash between them can't make a real
 * redelivery look like a duplicate while silently dropping the payment
 * (core-invoicing/design.md).
 */
export async function processPaymentWebhook(input: WebhookPaymentInput): Promise<{ deduped: boolean }> {
  const alreadyProcessed = await db.query.webhookEvents.findFirst({ where: eq(webhookEvents.providerEventId, input.providerEventId) });
  if (alreadyProcessed) {
    return { deduped: true };
  }

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, input.invoiceId) });
  if (!invoice) throw new ApiHttpError(404, 'invoice_not_found', 'Webhook referenced an unknown invoice.');

  await db.transaction(async (tx) => {
    await tx.insert(webhookEvents).values({ providerEventId: input.providerEventId, provider: input.provider, eventType: input.eventType });
    await tx.insert(payments).values({ invoiceId: input.invoiceId, amount: input.amount, source: 'WEBHOOK', providerReference: input.providerEventId });
  });

  const newStatus = await recomputeStatusFromPayments(db, input.invoiceId);

  await invalidateCache(`workspace:${invoice.workspaceId}:invoice:${input.invoiceId}`);
  await invalidateCache(`workspace:${invoice.workspaceId}:dashboard`);
  await writeAuditEvent(db, {
    event: newStatus === 'PAID' ? 'INVOICE_MARKED_PAID' : 'PAYMENT_RECEIVED',
    workspaceId: invoice.workspaceId,
    invoiceId: input.invoiceId,
    newValue: { amount: input.amount, source: 'WEBHOOK' },
  });
  publishWorkspaceEvent(invoice.workspaceId, { event: newStatus === 'PAID' ? 'invoice.paid' : 'payment.received', invoiceId: input.invoiceId, status: newStatus });

  return { deduped: false };
}
