import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function MarketingHomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex items-center gap-2">
        <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
          <path d="M6 4h12c2.2 0 4 1.8 4 4v16H10c-2.2 0-4-1.8-4-4V4z" fill="#2563EB" />
          <path d="M14 4h8v8z" fill="#93C5FD" />
        </svg>
        <span className="text-xl font-bold text-text-primary">Billify</span>
      </div>
      <h1 className="text-4xl font-bold text-text-primary sm:text-5xl">Invoice. Get Paid. Grow.</h1>
      <p className="max-w-xl text-lg text-text-secondary">
        Simple invoicing for freelancers, consultants, and small agencies. Create professional invoices, track payments, and stop manually chasing clients.
      </p>
      <div className="flex gap-3">
        <Link href="/signup">
          <Button size="lg">Start for free</Button>
        </Link>
        <Link href="/login">
          <Button size="lg" variant="secondary">
            Log in
          </Button>
        </Link>
      </div>
    </main>
  );
}
