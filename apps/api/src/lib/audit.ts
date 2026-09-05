import type { DbOrTx, InvoiceEventType } from '@invoice-saas/db';
import { invoiceEvents } from '@invoice-saas/db';

export interface AuditEventInput {
  event: InvoiceEventType;
  workspaceId?: string;
  invoiceId?: string;
  userId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}

// One writer for every financial/security event in the system — every
// financial-state-changing action, and now auth/team events too, goes through
// this so `invoice_events` never has an ad hoc insert shape (domain skill).
export async function writeAuditEvent(db: DbOrTx, input: AuditEventInput): Promise<void> {
  await db.insert(invoiceEvents).values({
    event: input.event,
    workspaceId: input.workspaceId,
    invoiceId: input.invoiceId,
    userId: input.userId,
    oldValue: input.oldValue as never,
    newValue: input.newValue as never,
    ipAddress: input.ipAddress,
  });
}

/**
 * Wraps a platform-staff read of tenant data with the audit write it requires
 * — co-located so the read and its audit trail can't drift apart (a
 * controller that "forgot" to call this separately is the failure mode this
 * avoids). See identity-and-rbac/design.md's admin-audit-on-view.
 */
export async function withAdminAuditLog<T>(
  db: DbOrTx,
  meta: { workspaceId: string; userId: string; detail: string },
  read: () => Promise<T>,
): Promise<T> {
  const result = await read();
  await writeAuditEvent(db, {
    event: 'TENANT_DATA_VIEWED',
    workspaceId: meta.workspaceId,
    userId: meta.userId,
    newValue: { detail: meta.detail },
  });
  return result;
}
