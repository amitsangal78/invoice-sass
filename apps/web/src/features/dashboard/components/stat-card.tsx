import type { ReactNode } from 'react';
import type { CurrencyTotal } from '../api/get-summary';
import { formatCurrency } from '@/lib/invoicing/status';

export type StatTone = 'primary' | 'success' | 'danger' | 'warning';

// Tints come from the design-system token layer, not literal hexes, so each
// card follows the active theme.
const TONE_CLASS: Record<StatTone, string> = {
  primary: 'bg-primary-light text-primary',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
};

/** Multi-currency workspaces get one line per currency — totals are never
 * summed across currencies (core-invoicing requirements). */
export function StatCard({ label, totals, tone, icon }: { label: string; totals: CurrencyTotal[]; tone: StatTone; icon: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-sm">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CLASS[tone]}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
      </div>
      <div className="text-[13px] text-text-secondary">{label}</div>
      {totals.length === 0 ? (
        <div className="mt-0.5 text-2xl font-bold text-text-primary">—</div>
      ) : (
        totals.map((total) => (
          <div key={total.currency} className="mt-0.5 text-2xl font-bold text-text-primary">
            {formatCurrency(total.amount, total.currency)}
          </div>
        ))
      )}
    </div>
  );
}
