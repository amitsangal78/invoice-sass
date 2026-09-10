import { apiFetch, getWorkspaceId } from '@/lib/api/server-client';

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface RevenuePoint {
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

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/dashboard/summary', { workspaceId: await getWorkspaceId() });
}
