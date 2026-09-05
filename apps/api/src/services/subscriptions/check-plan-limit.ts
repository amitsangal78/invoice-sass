import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { db, subscriptions, clients, invoices } from '@invoice-saas/db';
import { cacheAside } from '../../lib/redis';
import { PLAN_LIMITS } from '../../config/plan-limits';
import { PlanLimitExceededError } from '../../lib/errors';

const PLAN_CACHE_TTL_SECONDS = 600; // 5-15 min range per tech.md

export type GatedAction = 'create_client' | 'create_invoice' | 'enable_reminders' | 'add_team_member' | 'custom_branding' | 'recurring_invoice';

async function getPlan(workspaceId: string) {
  return cacheAside(`workspace:${workspaceId}:plan`, PLAN_CACHE_TTL_SECONDS, async () => {
    const [sub] = await db.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    return sub?.plan ?? 'FREE';
  });
}

/**
 * Enforced server-side before the gated mutation, never left to a hidden UI
 * button (identity-and-rbac/core-invoicing requirements). Throws
 * PlanLimitExceededError (HTTP 402) rather than a generic error, so the
 * frontend can render a clear upgrade prompt.
 */
export async function checkPlanLimit(workspaceId: string, action: GatedAction): Promise<void> {
  const plan = await getPlan(workspaceId);
  const limits = PLAN_LIMITS[plan];

  switch (action) {
    case 'create_client': {
      const [row] = await db
        .select({ total: count() })
        .from(clients)
        .where(and(eq(clients.workspaceId, workspaceId), isNull(clients.archivedAt)));
      if ((row?.total ?? 0) >= limits.maxClients) throw new PlanLimitExceededError('adding another client', plan);
      return;
    }
    case 'create_invoice': {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const [row] = await db
        .select({ total: count() })
        .from(invoices)
        .where(and(eq(invoices.workspaceId, workspaceId), gte(invoices.createdAt, startOfMonth)));
      if ((row?.total ?? 0) >= limits.maxInvoicesPerMonth) throw new PlanLimitExceededError('creating another invoice this month', plan);
      return;
    }
    case 'enable_reminders':
      if (!limits.autoReminders) throw new PlanLimitExceededError('automatic reminders', plan);
      return;
    case 'recurring_invoice':
      if (!limits.recurringInvoices) throw new PlanLimitExceededError('recurring invoices', plan);
      return;
    case 'custom_branding':
      if (!limits.customBranding) throw new PlanLimitExceededError('custom branding', plan);
      return;
    case 'add_team_member': {
      // Counted where identity-and-rbac's member service calls this — kept
      // here only for the limit definition; membership counting lives with
      // workspace_members, not duplicated in this file.
      return;
    }
  }
}
