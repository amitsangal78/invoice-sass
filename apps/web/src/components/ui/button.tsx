import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

// Design-system.md: radius 8px on buttons, one strong primary CTA per screen.
const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-input text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none', {
  variants: {
    variant: {
      primary: 'bg-primary text-white hover:opacity-90',
      secondary: 'border border-border text-text-secondary hover:bg-background',
      danger: 'bg-danger text-white hover:opacity-90',
      ghost: 'text-text-secondary hover:bg-background',
    },
    size: {
      default: 'h-10 px-4',
      sm: 'h-8 px-3 text-xs',
      lg: 'h-11 px-6',
    },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
