'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { loginAction } from '../api/actions';

const FIELD_CLASS =
  'h-[3.25rem] w-full rounded-[10px] border border-border bg-surface px-4 text-[0.9375rem] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {crossed ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <form action={formAction} className="mt-9 flex flex-col gap-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-[0.875rem] font-semibold text-text-primary">
            Email address
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" className={FIELD_CLASS} />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-[0.875rem] font-semibold text-text-primary">
              Password
            </label>
            <Link href="/forgot-password" className="text-[0.8125rem] font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={`${FIELD_CLASS} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <EyeIcon crossed={!showPassword} />
            </button>
          </div>
        </div>

        <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 text-[0.9375rem] text-text-secondary">
          <input
            id="remember"
            name="remember"
            type="checkbox"
            className="h-[18px] w-[18px] cursor-pointer rounded-[5px] border-border text-primary accent-primary focus:ring-2 focus:ring-primary/30"
          />
          Remember me for 30 days
        </label>

        {state.error ? <p className="text-[0.875rem] text-danger">{state.error}</p> : null}

        <button
          type="submit"
          disabled={isPending}
          className="flex h-[3.5rem] w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[0.9375rem] font-semibold text-white transition-opacity hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 disabled:opacity-60"
        >
          {isPending ? 'Signing in…' : 'Sign in'}
          {isPending ? null : <span aria-hidden="true">→</span>}
        </button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[0.8125rem] text-text-muted">or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Visual only — the backend is self-built JWT with no OAuth provider,
          so there is nothing to hand off to yet. */}
      <button
        type="button"
        className="flex h-[3.5rem] w-full items-center justify-center gap-3 rounded-[10px] border border-border bg-surface text-[0.9375rem] font-semibold text-text-primary transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <GoogleMark />
        Continue with Google
      </button>

      <p className="mt-7 text-center text-[0.9375rem] text-text-secondary">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Start for free →
        </Link>
      </p>
    </>
  );
}
