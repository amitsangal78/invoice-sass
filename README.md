# Invoice workspace

Internal test-money invoice SaaS. The design documents in [docs](docs/) define the full MVP; this implementation delivers the complete local foundation, role workflows (Vendor Owner, Invoice Creator, Platform Owner, and Customer), immutable revisions, sequential numbering, ledger allocations, and customer invoice payment portal. Test mode only; live payments and refunds are disabled per PRD.

## Included in this release

- **Next.js Web**:
  - Vendor Owner Workspace: Onboarding review status, live metrics dashboard, invoices list, invoice issuance & review actions, Creator management (max 5 active / 15 total), customer directory, catalogue items, payment records & allocation ledger.
  - Invoice Creator Workbench: Draft creation with real-time tax/discount computation, preview generation, submission to Owner, rework handling.
  - Platform Owner Console: Vendor onboarding review (`APPROVE`, `REJECT`, `MORE_INFO`), sensitive profile change request approval, vendor blocking/restoring, background job monitoring.
  - Public Customer Portal (`/pay/[token]`): 5-day hashed token verification, OTP email verification granting 15-minute customer session, invoice line item breakdown, PDF download link, simulated test payment (UPI / Netbanking / QR), receipt generation, link renewal (available before/after expiry and after full payment).
- **Express API**:
  - Strict shared validation schemas (Zod).
  - Secure HTTP-only cookies for web sessions, distinct Bearer tokens for mobile.
  - Trusted Origin verification and CSRF protection.
  - Comprehensive tenant RLS enforcement on all database queries.
  - Sequential invoice numbering (`INV-YYYY-XXXX`).
  - Monthly free quota enforcement (10 issued invoices per vendor per India calendar month).
  - Webhook processing with Razorpay signature verification and deduplication.
  - Credit notes (draft & issue), dispute tracking, manual payment reversals, reconciliation cases.
- **PostgreSQL**:
  - Direct localhost PostgreSQL support (or Docker).
  - Complete schema migrations (`001_identity_foundation.sql` and `002_complete_schema.sql`) defining 47 tables with RLS and trigger enforcement.
  - Restricted runtime role (`invoice_app`) with `NOBYPASSRLS`.
- **Background Worker**:
  - Polling with lease tokens, concurrency management, and exponential backoff.
  - Supports `OTP`, `EMAIL`, `PDF`, `RECURRING`, and `REMINDER` outbox job types.
  - Local mail preview in `.local/mail` for development.
- **React Native / Expo Mobile**:
  - Cross-platform Android and iOS bundles.
  - Bearer token authentication for Owner and Creator roles.
  - Invoice overview, draft creation, and creator monitoring.

## Local startup

Use Node 22.15+ (from `.nvmrc`) and your local PostgreSQL instance running on `localhost:5432`.

### 1. Configure Environment
Ensure `.env` points to your local PostgreSQL instance:
```sh
DATABASE_URL=postgresql://invoice_app:welcome%40123@127.0.0.1:5432/invoice_dev
MIGRATION_DATABASE_URL=postgresql://invoice_admin:welcome%40123@127.0.0.1:5432/invoice_dev
TEST_DATABASE_URL=postgresql://invoice_admin:welcome%40123@127.0.0.1:5432/invoice_test
```

### 2. Run Database Migrations
```sh
npm run db:migrate
```

### 3. Start Development Services
Run the API and Web frontend concurrently:
```sh
npm run dev
```

Run all services (API, Web frontend, and background Worker) concurrently:
```sh
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Background Worker (if running separately)
```sh
npm run dev:worker
```
Local OTP codes and email notifications are written to `.local/mail/*.json`.

### 5. Mobile Application
```sh
npm run dev:mobile
```

### 6. Verification Commands
```sh
npm run typecheck    # Typechecks all 6 packages and apps
npm test             # Unit, calculation, and HTTP boundary tests
npm run test:db      # Real-database integration test against local PostgreSQL
npm run build        # Production Next.js web application build
npm run check:mobile # Expo iOS & Android bundle export
```

## Razorpay and email provider setup

See [Razorpay and SES/Resend setup](docs/RAZORPAY-EMAIL-SETUP.md) for test credentials, webhook configuration, the Platform Owner email-provider dropdown, and local SES emulation. Live payments remain disabled.
# invoice-sass
