import type { RecentPayment } from '../api/get-summary';
import { formatCurrency } from '@/lib/invoicing/status';

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export function RecentPayments({ payments }: { payments: RecentPayment[] }) {
  return (
    <div className="flex-1 rounded-card border border-border bg-surface p-5">
      <h2 className="mb-3.5 text-base font-semibold text-text-primary">Recent Payments</h2>

      {payments.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No payments recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {payments.map((payment) => (
            <li key={payment.paymentId} className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text-primary">{payment.clientName}</span>
                <span className="block text-xs text-text-muted">{relativeDay(payment.paidAt)}</span>
              </span>
              <span className="text-[13px] font-semibold text-text-primary">{formatCurrency(payment.amount, payment.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
