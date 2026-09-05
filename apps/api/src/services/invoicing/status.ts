import { eq } from 'drizzle-orm';
import { invoices, payments, type InvoiceStatus, type DbOrTx } from '@invoice-saas/db';
import { sum, isGreaterThanOrEqual, isGreaterThanZero } from '../../lib/money/decimal';
import { InvalidStatusTransitionError } from '../../lib/errors';

// core-invoicing/design.md — every status write in the codebase goes through
// assertTransition() first; no route or job sets invoices.status via a raw update.
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID'],
  PAID: [],
  CANCELLED: [],
};

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (from === to) return; // setting the same status again is a no-op, not an error
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

export async function setInvoiceStatus(db: DbOrTx, invoiceId: string, currentStatus: InvoiceStatus, newStatus: InvoiceStatus): Promise<void> {
  assertTransition(currentStatus, newStatus);
  await db.update(invoices).set({ status: newStatus }).where(eq(invoices.id, invoiceId));
}

/**
 * Recomputes PARTIALLY_PAID vs. PAID from the actual payments recorded,
 * using decimal-safe comparison — never a float-approximate one
 * (core-invoicing/design.md). Called after every payment insert.
 */
export async function recomputeStatusFromPayments(db: DbOrTx, invoiceId: string): Promise<InvoiceStatus> {
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const rows = await db.select({ amount: payments.amount }).from(payments).where(eq(payments.invoiceId, invoiceId));
  const totalPaid = sum(rows.map((r) => r.amount));

  let nextStatus: InvoiceStatus;
  if (isGreaterThanOrEqual(totalPaid, invoice.total)) {
    nextStatus = 'PAID';
  } else if (isGreaterThanZero(totalPaid)) {
    nextStatus = 'PARTIALLY_PAID';
  } else {
    return invoice.status; // no payments yet — nothing to recompute
  }

  await setInvoiceStatus(db, invoiceId, invoice.status, nextStatus);
  return nextStatus;
}
