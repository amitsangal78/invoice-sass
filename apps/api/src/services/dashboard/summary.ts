import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, invoices, payments, clients } from '@invoice-saas/db';
import { cacheAside } from '../../lib/redis';

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface RevenuePoint {
  /** First day of the month, ISO date (YYYY-MM-01) — the UI formats it. */
  month: string;
  currency: string;
  amount: string;
}

export interface RecentPayment {
  paymentId: string;
  clientName: string;
  amount: string;
  currency: string;
  paidAt: string;
}

export interface DashboardSummary {
  outstanding: CurrencyTotal[];
  paid: CurrencyTotal[];
  paidThisMonth: CurrencyTotal[];
  overdue: CurrencyTotal[];
  dueSoon: CurrencyTotal[];
  revenueTrend: RevenuePoint[];
  recentPayments: RecentPayment[];
}

const DASHBOARD_CACHE_TTL_SECONDS = 60; // 30-120s range per tech.md
const DUE_SOON_DAYS = 7;
const TREND_MONTHS = 6;
const RECENT_PAYMENTS_LIMIT = 5;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Grouped by currency, never summed across currencies (core-invoicing
 * requirements — ₹50,000 and $2,000 stay two lines). Postgres NUMERIC SUM
 * is exact, so this aggregation is safe to do in SQL rather than pulling
 * every row into JS for decimal.js summation.
 *
 * Everything the dashboard renders comes back in one payload because it all
 * shares this single cache entry and a single page consumes it.
 */
export async function getDashboardSummary(workspaceId: string): Promise<DashboardSummary> {
  return cacheAside(`workspace:${workspaceId}:dashboard`, DASHBOARD_CACHE_TTL_SECONDS, async () => {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1), 1));
    const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);

    const totalByCurrency = { currency: invoices.currency, amount: sql<string>`coalesce(sum(${invoices.total}), 0)` };

    const outstandingRows = await db
      .select(totalByCurrency)
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), inArray(invoices.status, ['SENT', 'OVERDUE', 'PARTIALLY_PAID'])))
      .groupBy(invoices.currency);

    const paidRows = await db
      .select(totalByCurrency)
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.status, 'PAID')))
      .groupBy(invoices.currency);

    const overdueRows = await db
      .select(totalByCurrency)
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.status, 'OVERDUE')))
      .groupBy(invoices.currency);

    // Still SENT and falling due within the next week — deliberately excludes
    // OVERDUE, which is already its own card.
    const dueSoonRows = await db
      .select(totalByCurrency)
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, workspaceId),
          eq(invoices.status, 'SENT'),
          gte(invoices.dueDate, isoDate(now)),
          lte(invoices.dueDate, isoDate(dueSoonCutoff)),
        ),
      )
      .groupBy(invoices.currency);

    // Derived from payments, not invoice status: an invoice being PAID says
    // nothing about *when* the money arrived.
    const paidThisMonthRows = await db
      .select({ currency: invoices.currency, amount: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(eq(invoices.workspaceId, workspaceId), gte(payments.paidAt, startOfMonth)))
      .groupBy(invoices.currency);

    const revenueTrend = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${payments.paidAt}), 'YYYY-MM-DD')`,
        currency: invoices.currency,
        amount: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(eq(invoices.workspaceId, workspaceId), gte(payments.paidAt, trendStart)))
      .groupBy(sql`date_trunc('month', ${payments.paidAt})`, invoices.currency)
      .orderBy(sql`date_trunc('month', ${payments.paidAt})`);

    const recentPaymentRows = await db
      .select({
        paymentId: payments.id,
        clientName: clients.name,
        amount: payments.amount,
        currency: invoices.currency,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(desc(payments.paidAt))
      .limit(RECENT_PAYMENTS_LIMIT);

    return {
      outstanding: outstandingRows,
      paid: paidRows,
      paidThisMonth: paidThisMonthRows,
      overdue: overdueRows,
      dueSoon: dueSoonRows,
      revenueTrend,
      recentPayments: recentPaymentRows.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() })),
    };
  });
}
