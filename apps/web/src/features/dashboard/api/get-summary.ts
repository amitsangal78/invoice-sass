import { apiFetch, getWorkspaceId } from '@/lib/api/server-client';

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface DashboardSummary {
  outstanding: CurrencyTotal[];
  paid: CurrencyTotal[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/dashboard/summary', { workspaceId: await getWorkspaceId() });
}
