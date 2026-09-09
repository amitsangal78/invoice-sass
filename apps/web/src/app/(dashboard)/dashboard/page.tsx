import Link from 'next/link';
import { getDashboardSummary, CurrencyTotalsCard } from '@/features/dashboard';
import { Button } from '@/components/ui/button';

// Server Component — authoritative read, no client-side fetch needed for the
// initial render (architecture-principles.md #1).
export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="mt-1 text-sm text-text-secondary">Here&apos;s what&apos;s happening with your business.</p>
        </div>
        <Link href="/invoices/new">
          <Button>+ New Invoice</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CurrencyTotalsCard label="Outstanding" totals={summary.outstanding} tint="#DBEAFE" />
        <CurrencyTotalsCard label="Paid" totals={summary.paid} tint="#DCFCE7" />
      </div>
    </div>
  );
}
