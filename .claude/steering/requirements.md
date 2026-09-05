# Platform-wide functional & non-functional requirements

These apply across every feature spec by default. A feature spec should only add requirements here if it needs something *beyond* this bar — not repeat it. No phased rollout — everything below is in scope for the current build.

Numbers marked ⚠️ are placeholders — pick real ones for your context; don't let a template value quietly become a commitment.

## Frontend (`apps/web` tenant app + marketing + client portal, `apps/admin` console)

**Functional**
- Signup/login (self-built JWT auth), email verification, password reset, workspace creation, client CRUD, invoice CRUD, dashboard totals, PDF preview/download.
- Team management: invite/remove members, assign ADMIN/MEMBER role, transfer ownership (owner only).
- Client portal: passwordless (magic link) login, view outstanding/overdue/paid invoices, pay, download receipts, view payment history.
- Live dashboard updates via SSE (invoice paid, overdue, reminder sent) without a manual refresh.
- Light/dark theme, driven by CSS variable tokens — no per-component theme variants.
- Responsive down to mobile browser widths.
- Admin console: cross-tenant search, tenant status/suspend/reactivate, plan overrides, webhook-event inspection, platform metrics — behind RBAC (SUPER_ADMIN / SUPPORT_ADMIN), never merged into the tenant app or sharing its session.

**Non-functional**
- Marketing pages: LCP < 2.5s on 4G (served via Next.js SSG/ISR).
- Authenticated dashboard: TTI < 3s on typical broadband. ⚠️
- WCAG 2.1 AA on the tenant dashboard and client portal (contrast, keyboard nav, visible focus).
- Last 2 major versions of Chrome, Safari, Firefox, Edge.
- Auth tokens never stored in plain localStorage — httpOnly cookies or secure storage only.

## Backend (`apps/api`)

**Functional**
- REST API, versioned under `/api/v1` from the start (multiple clients — web, admin, mobile — depend on it immediately, so a breaking change can't ship without a version bump).
- Self-built JWT (access + refresh) verification on every authenticated route, followed by workspace-membership + role resolution — see `rules/backend-api.md`.
- Idempotent webhook processing for both invoice-payment providers (Razorpay/Stripe) and subscription-billing providers — verify signature → dedupe via `webhook_events` → update state.
- Rate limiting on every public/unauthenticated endpoint: signup, magic-link request, webhooks, public pay links.
- SSE endpoint(s) for live dashboard updates, scoped per workspace.

**Non-functional**
- p95 latency < 300ms for CRUD endpoints (PDF generation and email send are async, excluded). ⚠️
- Uptime target: ⚠️ pick a real number once you have real users — don't inherit "99.9%" by default, it implies infrastructure you may not have built yet.
- Secrets only in env vars / AWS Secrets Manager — never committed.
- Structured JSON logs (pino), every line carrying a request id + `user_id` + `workspace_id` where applicable.
- Neon point-in-time recovery/branching, with an explicit confirmed retention window (7-day minimum) — don't assume the platform default matches what's needed.
- API is stateless (JWT, no in-memory session state) so it can run multiple containers behind a load balancer.
- Every financial-state-changing action writes an `invoice_events` audit row — see `tech.md`.

## Mobile app (`apps/mobile`, iOS + Android)

**Functional**
- Dashboard, clients, invoice list/detail, create a simple invoice, send/share invoice, mark payment received, view payments, customer search, basic reports.
- Push notification on payment/overdue events.
- Subscription is view-only ("Manage on web") — no in-app purchase, no StoreKit/Play Billing integration.
- No complex invoice editing, workspace settings, team management, subscription management, branding, or Super Admin functionality — those stay web-only.

**Non-functional**
- Biometric app-lock (Face ID/Touch ID, Android biometric) — the app holds financial data.
- Deep-link to the same hosted payment page used on web rather than embedding card entry — avoids PCI/app-store payment-SDK complexity.
- Minimum OS support: iOS ⚠️ / Android ⚠️ — pick versions based on your actual users.
- Cold start < 2s on a mid-range device. ⚠️
- Cached read of the last-fetched dashboard/invoice list for offline viewing, clearly marked as stale data.
- Push delivery via Expo Push → FCM/APNs; core features must degrade gracefully without push permission granted.
- App Store / Play policy compliance: no in-app card capture, no in-app subscription purchase — both stay on the web/hosted-payment-page path.
