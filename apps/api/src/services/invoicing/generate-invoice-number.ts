import { eq, sql } from 'drizzle-orm';
import { invoiceSequences, type DbOrTx } from '@invoice-saas/db';

/**
 * Transaction-safe invoice number generation. The `UPDATE ... RETURNING` on a
 * single-row-per-workspace table is what makes concurrent invoice creation
 * safe — Postgres serializes the row lock — not any application-level
 * locking (core-invoicing/design.md).
 *
 * MUST be called with the same transaction that inserts the `invoices` row,
 * or two concurrent requests could both read/bump the sequence but one's
 * invoice insert could fail after the number was already consumed.
 */
export async function generateInvoiceNumber(tx: DbOrTx, workspaceId: string): Promise<string> {
  // Ensure a sequence row exists, provisioned at 0 (not the column's default
  // of 1) — this call always increments-then-returns below, so seeding at 0
  // makes the first invoice come out numbered 1, not 2. Defensive: signup()
  // should have created this row per workspace, but this makes the function
  // correct even if called for a workspace whose sequence row is missing.
  await tx.insert(invoiceSequences).values({ workspaceId, nextNumber: 0 }).onConflictDoNothing();

  const [seq] = await tx
    .update(invoiceSequences)
    .set({ nextNumber: sql`${invoiceSequences.nextNumber} + 1` })
    .where(eq(invoiceSequences.workspaceId, workspaceId))
    .returning();

  if (!seq) throw new Error(`Failed to allocate invoice number for workspace ${workspaceId}`);

  const year = new Date().getFullYear();
  return `${seq.prefix}-${year}-${String(seq.nextNumber).padStart(4, '0')}`;
}
