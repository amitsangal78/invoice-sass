import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/invoicing/status';
import type { CurrencyTotal } from '../api/get-summary';

// Grouped by currency, never summed across currencies — core-invoicing's
// dashboard requirement. Multiple currency lines render stacked, not merged.
export function CurrencyTotalsCard({ label, totals, tint }: { label: string; totals: CurrencyTotal[]; tint: string }) {
  return (
    <Card>
      <div className="mb-3 h-9 w-9 rounded-input" style={{ backgroundColor: tint }} />
      <div className="text-sm text-text-secondary">{label}</div>
      {totals.length === 0 ? (
        <div className="mt-1 text-2xl font-bold text-text-primary">—</div>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5">
          {totals.map((t) => (
            <div key={t.currency} className="text-2xl font-bold text-text-primary">
              {formatCurrency(t.amount, t.currency)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
