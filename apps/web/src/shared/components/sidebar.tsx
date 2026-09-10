'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// The design comp also shows Payments, Reports, Team and Settings. Those pages
// don't exist, so they aren't rendered — a nav item that goes nowhere is worse
// than an absent one.
const NAV_ITEMS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </>
    ),
  },
  {
    href: '/invoices',
    label: 'Invoices',
    icon: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <line x1="8" y1="8" x2="16" y2="8" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="12" y2="16" />
      </>
    ),
  },
  {
    href: '/clients',
    label: 'Clients',
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle cx="17.5" cy="9" r="2.2" />
        <path d="M15.8 14.2c2.3.3 4.2 2.3 4.2 5.8" />
      </>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex w-60 flex-shrink-0 flex-col border-r border-border bg-surface px-4 py-6">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
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
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive ? 'bg-primary-light font-semibold text-primary' : 'font-medium text-text-secondary hover:bg-background hover:text-text-primary'
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
