# Architecture principles

Six principles that govern every architectural decision across `apps/web`, `apps/admin`, `apps/api`, and `apps/mobile`. Adapted from a mature reference implementation. Each is a rule plus a concrete right/wrong pair.

## 1. Server-first by default (web + admin)

Use Server Components for initial page composition and authoritative reads. Reach for `'use client'` only when a component needs interactivity, browser APIs, or hooks.

```tsx
// ✅ correct — page is a Server Component; only the interactive bit is a client island
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  return <><InvoiceHeader invoice={invoice} /><MarkPaidButton invoiceId={id} /></>;
}
// ❌ wrong — whole page marked client just to render mostly-static invoice data
"use client";
export default function InvoicePage() { const { data } = useInvoiceQuery(id); }
```

## 2. Strict boundary between UI and integrations

UI components never call a payment provider, email service, or third-party API directly. All integration traffic passes through `apps/api` services and typed adapters.

```tsx
// ✅ correct — UI calls our own API; the service layer owns the Stripe/Razorpay call
const { mutate: payInvoice } = usePayInvoice();
// ❌ wrong — component calls Stripe directly from the browser
const res = await fetch("https://api.stripe.com/v1/payment_intents", ...);
```

## 3. Graceful degradation is mandatory

A non-critical dependency failing must degrade safely, never collapse a core journey.

```tsx
// ✅ correct — dashboard totals widget fails independently; the rest of the dashboard still renders
{summary.status === "error" ? <SummaryUnavailable /> : <DashboardTotals data={summary.data} />}
// ❌ wrong — one non-critical failure throws and takes down the whole dashboard
const summary = await getDashboardSummary(); // unguarded; throws → page 500s
```

## 4. State belongs where it is owned

- Server-owned data (an invoice, a client) stays server-first — fetched via TanStack Query, not duplicated into a store.
- Shareable navigation state (which status filter, which tab) belongs in the URL, not `useState`.
- Browser-only workflow/UI state (a modal open, a form draft) belongs in local state or a Zustand slice.

```tsx
// ✅ correct — selected invoice status filter is shareable → lives in the URL
// /invoices?status=overdue
// ❌ wrong — shareable filter state trapped in useState (breaks deep links + back button)
const [status, setStatus] = useState("overdue");
```

## 5. Deterministic transactional behaviour

Payments, plan upgrades, and status changes use authoritative backend/webhook confirmation, idempotency keys, and explicit pending/error/confirmed states — never optimistic success. This is the same rule already codified in the `invoice-reminder-saas-domain` skill for webhook handling; it's restated here because it's a platform-wide principle, not just a payments detail.

```ts
// ✅ correct — only a verified webhook confirms; UI shows pending until then
return invoice.status === "paid" ? confirm() : showPending();
// ❌ wrong — optimistic success before the webhook confirms
setPaid(true); await createPaymentLink(invoice);
```

## 6. No shared mutable globals

Avoid module-level singletons that leak state across requests — this matters for `apps/api` running multiple concurrent requests, and for `apps/web` Server Components running per-request.

```ts
// ✅ correct — per-request client, no shared mutable state
export const getDbClient = () => drizzle(pool);
// ❌ wrong — module-level singleton accumulating state across requests
export const currentUser = { id: null }; // mutated per-request — leaks across users
```
