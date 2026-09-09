import { LoginForm } from '@/features/auth';

const TRUST_POINTS = ['No credit card required', 'Easy setup', 'Cancel anytime'];

const STATS = [
  { value: '50K+', label: 'Businesses' },
  { value: '₹2Cr+', label: 'Invoiced' },
  { value: '99.9%', label: 'Uptime' },
];

function CheckCircle() {
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white/25">
      <svg viewBox="0 0 24 24" fill="none" className="h-[11px] w-[11px]" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen">
      {/* Brand panel — hidden below lg, where the form takes the full width. */}
      <aside className="relative hidden w-[44%] shrink-0 overflow-hidden bg-primary px-14 py-14 text-white lg:flex lg:flex-col">
        {/* Decorative field — low-opacity circles, purely atmospheric. */}
        {/* aspect-square, not a percentage height — a %-of-height circle
            distorts into an oval on tall or short viewports. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-[51%] top-[-4%] aspect-square w-[53%] rounded-full bg-white/[0.09]" />
          <div className="absolute left-[-9%] top-[58%] aspect-square w-[52%] rounded-full bg-white/[0.07]" />
          <div className="absolute left-[73%] top-[52%] aspect-square w-[21%] rounded-full bg-white/[0.08]" />
        </div>

        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-white text-[26px] font-bold leading-none text-primary">
            B
          </span>
          <span className="text-[26px] font-bold tracking-tight">Billify</span>
        </div>

        <div className="relative mt-auto">
          <h1 className="text-[2.5rem] font-bold leading-[1.15] tracking-[-0.02em]">
            Less admin.
            <br />
            More progress.
          </h1>
          <p className="mt-6 max-w-[27rem] text-[1.0625rem] leading-[1.6] text-white/80">
            Create professional invoices, accept online payments and keep track of your business — all in one place.
          </p>

          <dl className="mt-12 flex gap-11">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <dt className="text-[1.6rem] font-bold leading-tight tracking-tight">{stat.value}</dt>
                <dd className="mt-0.5 text-[0.9375rem] text-white/70">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ul className="relative mt-auto flex flex-wrap gap-x-7 gap-y-2 pt-14 text-[0.875rem] text-white/80">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <CheckCircle />
              {point}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form panel */}
      <div className="relative flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-surface to-background px-6 py-16">
        <div className="w-full max-w-[26rem]">
          <h2 className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-text-primary">Welcome back</h2>
          <p className="mt-2 text-[0.9375rem] text-text-secondary">Sign in to your Billify account</p>
          <LoginForm />
        </div>

        {/* px-16 keeps the notice clear of the help button on narrow viewports. */}
        <p className="absolute bottom-8 px-16 text-center text-[0.8125rem] text-text-muted">© 2026 Billify · Invoices. Payments. Growth.</p>

        <a
          href="mailto:support@billify.dev"
          aria-label="Get help signing in"
          className="absolute bottom-7 right-7 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-[0.9375rem] font-semibold text-text-secondary shadow-sm transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          ?
        </a>
      </div>
    </main>
  );
}
