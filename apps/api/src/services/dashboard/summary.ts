import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, invoices } from '@invoice-saas/db';
import { cacheAside } from '../../lib/redis';

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface DashboardSummary {
  outstanding: CurrencyTotal[];
  paid: CurrencyTotal[];
}

const DASHBOARD_CACHE_TTL_SECONDS = 60; // 30-120s range per tech.md

/**
 * Grouped by currency, never summed across currencies (core-invoicing
 * requirements — ₹50,000 and $2,000 stay two lines). Postgres NUMERIC SUM
 * is exact, so this aggregation is safe to do in SQL rather than pulling
 * every row into JS for decimal.js summation.
 */
export async function getDashboardSummary(workspaceId: string): Promise<DashboardSummary> {
  return cacheAside(`workspace:${workspaceId}:dashboard`, DASHBOARD_CACHE_TTL_SECONDS, async () => {
    const outstandingRows = await db
      .select({ currency: invoices.currency, amount: sql<string>`coalesce(sum(${invoices.total}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), inArray(invoices.status, ['SENT', 'OVERDUE', 'PARTIALLY_PAID'])))
      .groupBy(invoices.currency);

    const paidRows = await db
      .select({ currency: invoices.currency, amount: sql<string>`coalesce(sum(${invoices.total}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.status, 'PAID')))
      .groupBy(invoices.currency);

    return { outstanding: outstandingRows, paid: paidRows };
  });
}
