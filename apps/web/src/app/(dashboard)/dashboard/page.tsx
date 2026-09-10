import Link from 'next/link';
import { getDashboardSummary, StatCard, RevenueTrend, RecentPayments, RecentInvoices } from '@/features/dashboard';
import { listInvoices } from '@/features/invoices/api/invoices';

const RECENT_INVOICE_COUNT = 5;

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Server Component — authoritative read, no client-side fetch needed for the
// initial render (architecture-principles.md #1).
export default async function DashboardPage() {
  const [summary, invoices] = await Promise.all([getDashboardSummary(), listInvoices()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* The comp greets by first name, but `users` has no name column —
              greeting without one beats inventing a value. */}
          <h1 className="text-[26px] font-bold text-text-primary">{greetingFor(new Date())}</h1>
          <p className="mt-1 text-sm text-text-secondary">Here&apos;s what&apos;s happening with your business today.</p>
        </div>
        <Link
          href="/invoices/new"
          className="flex flex-shrink-0 items-center gap-2 rounded-lg bg-primary px-[18px] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Invoice
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding"
          totals={summary.outstanding}
          tone="primary"
          icon={<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />}
        />
        <StatCard label="Paid This Month" totals={summary.paidThisMonth} tone="success" icon={<polyline points="20 6 9 17 4 12" />} />
        <StatCard
          label="Overdue"
          totals={summary.overdue}
          tone="danger"
          icon={
            <>
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="7" x2="12" y2="13" />
              <line x1="12" y1="16.4" x2="12" y2="16.5" />
            </>
          }
        />
        <StatCard
          label="Due Soon"
          totals={summary.dueSoon}
          tone="warning"
          icon={
            <>
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15.5 14" />
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <RecentInvoices invoices={invoices.slice(0, RECENT_INVOICE_COUNT)} />
        <div className="flex flex-col gap-4">
          <RevenueTrend points={summary.revenueTrend} />
          <RecentPayments payments={summary.recentPayments} />
        </div>
      </div>
    </div>
  );
}
