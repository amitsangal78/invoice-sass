import type { RevenuePoint } from '../api/get-summary';
import { formatCurrency } from '@/lib/invoicing/status';

const MONTH_LABEL = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

/**
 * Renders the workspace's dominant currency only. Bars of different currencies
 * can't share a y-axis without implying an exchange rate, and this product
 * deliberately has no conversion engine (tech.md, Currency).
 */
export function RevenueTrend({ points }: { points: RevenuePoint[] }) {
  const totalPerCurrency = new Map<string, number>();
  for (const point of points) {
    totalPerCurrency.set(point.currency, (totalPerCurrency.get(point.currency) ?? 0) + Number(point.amount));
  }
  const dominant = [...totalPerCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const series = points.filter((p) => p.currency === dominant);
  const peak = Math.max(...series.map((p) => Number(p.amount)), 0);

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-text-primary">Revenue Trend</h2>
        {totalPerCurrency.size > 1 ? <span className="text-xs text-text-muted">{dominant} only</span> : null}
      </div>

      {series.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No payments received yet.</p>
      ) : (
        <div>
          {/* Bars are direct children of the fixed-height row: a percentage
              height needs a parent with a definite height to resolve against,
              so labels live in their own row below rather than inside it. */}
          <div className="flex h-[100px] items-end gap-2.5">
            {series.map((point) => {
              const value = Number(point.amount);
              // Floor at 4% so a real-but-tiny month is still visible rather
              // than rendering as nothing.
              const heightPct = peak > 0 ? Math.max((value / peak) * 100, 4) : 4;
              const isPeak = value === peak && peak > 0;
              return (
                <div
                  key={point.month}
                  className={`flex-1 rounded ${isPeak ? 'bg-primary' : 'bg-primary-light'}`}
                  style={{ height: `${heightPct}%` }}
                  title={`${MONTH_LABEL.format(new Date(point.month))}: ${formatCurrency(point.amount, point.currency)}`}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-2.5">
            {series.map((point) => (
              <span key={point.month} className="flex-1 text-center text-[11px] text-text-muted">
                {MONTH_LABEL.format(new Date(point.month))}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
