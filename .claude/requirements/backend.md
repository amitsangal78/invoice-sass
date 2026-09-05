# Backend (`apps/api`) — Functional & Non-Functional Requirements

Full scope, no phasing. Cross-reference: `steering/tech.md` (stack + Redis/Bloom-filter conventions), `steering/architecture-principles.md`, `rules/backend-api.md`, `skills/invoice-reminder-saas-domain` (data model, state machine, RBAC table), and the specs under `.claude/specs/`. This doc is the surface-level checklist; the specs carry the detailed per-story behavior.

## Functional requirements

### Auth (self-built — see `tech.md` for what this makes us responsible for)
- **Signup**: validate request → check email uniqueness → hash password (Argon2/bcrypt) → create `users` row → create `workspaces` row → create `workspace_members` row (`ADMIN`) → set `workspaces.owner_id` → generate email-verification token → send verification email.
- **Login**: find user → verify password → check active/verified status → issue access JWT (`{ sub, platformRole }`, short-lived, ~15 min) → issue refresh token → store the refresh token **hashed** in `refresh_tokens` → return session.
- **Email verification**: generate secure token → store hashed → expire → mark used → mark user verified.
- **Password reset**: generate secure token → store hashed → set expiration → allow change → invalidate the reset token → optionally invalidate existing refresh tokens.
- **Session management**: refresh-token flow (rotate on use), logout (revoke one device), logout-all-devices, token revocation on role removal.

### Authorization
`Authentication → workspace membership → role → permission → resource ownership`, resolved fresh per request (never cached in the token) — see `identity-and-rbac` spec and the RBAC table in the domain skill.

### API surface (indicative — finalize exact shapes in `design.md`)

| Resource | Routes |
|---|---|
| Workspaces | `POST /workspaces`, `GET /workspaces`, `GET /workspaces/:id`, `PATCH /workspaces/:id` |
| Members | `GET /workspaces/:id/members`, `POST /workspaces/:id/invitations`, `PATCH /workspaces/:id/members/:userId`, `DELETE /workspaces/:id/members/:userId` |
| Clients | `POST /clients`, `GET /clients`, `GET /clients/:id`, `PATCH /clients/:id`, `DELETE /clients/:id` (prefer archive/soft-delete once a client has invoice history) |
| Invoices | `POST /invoices`, `GET /invoices`, `GET /invoices/:id`, `PATCH /invoices/:id`, `DELETE /invoices/:id`, `POST /invoices/:id/send`, `POST /invoices/:id/mark-paid`, `POST /invoices/:id/cancel`, `GET /invoices/:id/pdf` |

Versioned under `/api/v1` from the start — three independent clients (web, admin, mobile) depend on it immediately.

### Invoice business rules
Validate on every mutation: workspace ownership, client ownership, current status (only legal transitions per the state machine in the domain skill — includes `PARTIALLY_PAID`/`CANCELLED`), valid amount, supported currency, valid due date.

### Invoice numbering
Unique per workspace, sequential where configured (`invoice_sequences`), safe under concurrent creation — use a database transaction/lock, never a read-then-increment race.

### Payments
- Invoice-payment flow: create Razorpay order → customer pays → Razorpay webhook → verify signature → dedupe via `webhook_events` (+ short-lived Redis idempotency key) → update `payments` + `invoices.status`. Stripe follows the same abstraction later.
- Offline payments: authorized users (ADMIN/MEMBER) record amount, method, reference, date, notes — tagged `source: manual`, distinct from webhook-confirmed payments.
- Subscription-billing webhook: separate handler, separate table (`subscriptions`) — never touches `payments`/`invoices`.
- Every webhook handler, after updating state: invalidate/update the relevant Redis cache keys, update the Bloom filter if the event affects a filtered set, record an `invoice_events` audit row, publish the SSE event.

### Reminders
Scheduled trigger → reminder job → find due invoices → send per `reminder_rules` → log in `reminder_events` (never resend a rule already logged for that invoice).

### Email
Backend sends: signup verification, password reset, invoice email, reminder email, payment receipt, team invitation.

### PDF generation
Backend generates invoice PDFs (business details, client details, invoice number, issue/due date, line items, tax, discount, total, currency, payment info, logo). S3 for logos, generated PDFs (if persisted), and exports.

### Real-time (SSE)
Authenticated, workspace-scoped SSE endpoint(s) exposing `invoice.updated`, `invoice.paid`, `payment.received`, `reminder.sent`. Tenant isolation is mandatory — never leak one workspace's events to another's connection.

### Subscription management
Plans, usage, limits, upgrade/downgrade, cancellation, billing state, renewal, webhook reconciliation — see `subscription-billing` spec. Plan limits enforced server-side, in one shared config — frontend hiding a button is not sufficient (e.g. Free plan's 5-invoices/month cap must be rejected by the API even if the UI fails to disable the button).

### Audit logging
Record at minimum: `LOGIN_SUCCESS`, `LOGIN_FAILED`, `CLIENT_CREATED`, `CLIENT_UPDATED`, `INVOICE_CREATED`, `INVOICE_SENT`, `INVOICE_UPDATED`, `INVOICE_CANCELLED`, `PAYMENT_RECEIVED`, `MEMBER_INVITED`, `ROLE_CHANGED`, `WORKSPACE_UPDATED`.

## Non-functional requirements

| Category | Requirement |
|---|---|
| Security | HTTPS everywhere; Argon2/bcrypt; secure JWT signing (secret in Secrets Manager, rotatable); refresh-token revocation; rate limiting (Redis-backed) on every public/unauthenticated endpoint; CORS restrictions; secure headers; zod input validation on every request; SQL-injection protection (parameterized queries only); tenant isolation on every query; RBAC on every route; webhook signature verification before trusting any payload field; no secrets in code or logs. |
| Performance | Ordinary API requests: target under ~500–800ms where practical. ⚠️ confirm once real traffic exists. High cache-hit paths (Redis) significantly faster. Minimize AWS↔Neon round trips; avoid N+1 queries; use connection pooling. Indexes on `workspace_id`, `user_id`, `client_id`, `invoice_id`, `email`, `status`, `due_date`, `created_at` at minimum. |
| Reliability | Handle gracefully: Redis failure (fall through to Postgres, degrade performance not correctness — see `tech.md`), Neon timeout, email-provider failure, payment-provider timeout, webhook retries/duplicates (idempotent per the domain skill), SSE disconnection (client reconnects, doesn't lose state). |
| Observability | Structured JSON logs (pino), request ids, error tracking, health checks (`/health`, `/health/ready`), cache hit/miss metrics, webhook metrics, payment metrics. |
| Scalability | Modular monolith initially: Node.js instances behind an ALB, sharing Redis, backed by Neon Postgres. No Kafka until real event volume or a genuine multi-consumer architecture need appears — see `tech.md`. |
| Data integrity | Foreign keys, unique constraints, check constraints, transactions around multi-table writes (e.g. webhook → `payments` + `invoices.status` together), `NUMERIC`/`DECIMAL` for every monetary column, never `float`. |
| Availability | Stateless API (JWT only, no in-memory session) so it can run multiple containers behind a load balancer. Uptime target ⚠️ — pick a real number once there are real users. |
| Backup/DR | Neon point-in-time recovery/branching; confirm an explicit retention window rather than assuming the platform default. RTO/RPO ⚠️ — not yet defined. |
| Compliance | Full financial audit trail (`invoice_events`); data residency: primary region `ap-south-1` if India-first; no PCI card data touches this backend directly — providers hold that, we hold links/tokens/references only. |
| Testing | Vitest + Supertest against a real Dockerized test Postgres, not mocked queries — required for anything touching invoice status or payments. Every new webhook handler needs a redelivery test case; every new RBAC check needs a denial-case test. |

## Explicit exclusions
General ledger, tax filing, inventory, currency conversion — see non-goals in `product.md`.
