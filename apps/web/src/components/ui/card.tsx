import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// Design-system.md: white cards, thin border, very subtle shadow, 12px radius.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]', className)} {...props} />;
}
