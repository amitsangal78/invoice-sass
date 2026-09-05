import type { Plan } from '@invoice-saas/db';

// One shared source of truth — every gated action calls checkPlanLimit()
// rather than reading this directly (subscription-billing/design.md).
// Pulled forward from that spec because core-invoicing's own requirements
// mandate real server-side enforcement now, not a permanent stub.
export const PLAN_LIMITS: Record<Plan, { maxClients: number; maxInvoicesPerMonth: number; autoReminders: boolean; recurringInvoices: boolean; customBranding: boolean; maxTeamMembers: number }> = {
  FREE: { maxClients: 3, maxInvoicesPerMonth: 5, autoReminders: false, recurringInvoices: false, customBranding: false, maxTeamMembers: 1 },
  STARTER: { maxClients: 25, maxInvoicesPerMonth: 50, autoReminders: true, recurringInvoices: false, customBranding: true, maxTeamMembers: Infinity },
  PRO: { maxClients: Infinity, maxInvoicesPerMonth: Infinity, autoReminders: true, recurringInvoices: true, customBranding: true, maxTeamMembers: Infinity },
};
