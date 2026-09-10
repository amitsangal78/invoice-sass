import Link from 'next/link';
import { logoutAction } from '@/features/auth';
import { ThemeToggle } from './theme-toggle';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

export function Topbar({ workspaceName }: { workspaceName: string }) {
  return (
    <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-8">
      {/* Search is presentational until there's a search endpoint — a link to
          the invoice list is an honest destination, an inert input isn't. */}
      <Link
        href="/invoices"
        className="flex h-9 w-80 items-center gap-2 rounded-lg border border-border bg-background px-3 text-text-muted transition-colors hover:border-border hover:text-text-secondary"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="text-[13px]">Search invoices, clients...</span>
      </Link>

      <div className="flex items-center gap-5">
        <Link href="/select-workspace" className="flex items-center gap-1.5 text-sm font-semibold text-text-primary hover:text-primary">
          {workspaceName}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Link>

        <ThemeToggle />

        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary-light text-[13px] font-bold text-primary">
          {initialsOf(workspaceName)}
        </div>

        <form action={logoutAction}>
          <button type="submit" className="text-sm font-medium text-text-secondary hover:text-text-primary">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
