'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/clients', label: 'Clients' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex w-60 flex-shrink-0 flex-col border-r border-border bg-surface p-4">
      <div className="mb-8 flex items-center gap-2 px-2">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M6 4h12c2.2 0 4 1.8 4 4v16H10c-2.2 0-4-1.8-4-4V4z" fill="var(--color-primary)" />
          <path d="M14 4h8v8z" fill="#93C5FD" />
        </svg>
        <span className="text-lg font-bold text-text-primary">Billify</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive
                  ? 'rounded-input bg-primary-light px-3 py-2.5 text-sm font-semibold text-primary'
                  : 'rounded-input px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-background'
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
