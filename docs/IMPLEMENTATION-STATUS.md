# Implementation status

14 November 2026 · Full MVP Implementation.

## Scope interpretation

The four v2.1 design documents serve as the system specification, with conversation decisions taking precedence: internal test money mode only, customer credit enabled on reductions while refund mechanism is deferred, 5-day invoice links with 15-minute customer sessions, link renewal available including after full payment, Owner-controlled Creator password management, and 10 issued invoices per India calendar month.

## Implemented

- **Database & Tenant Architecture**: Complete migrations (`001_identity_foundation.sql` and `002_complete_schema.sql`) covering users, vendors, memberships, platform owners, auth sessions, OTP challenges, auth identities, auth grants, vendor profiles, change requests, customers, tax profiles, catalogue items, invoices, invoice lines, invoice revisions, invoice actions, document sequences, monthly usage, quota events, provider accounts, payment attempts, provider events, payments, payment allocations, allocation reversals, payment reversals, credit notes, credit note lines, disputes, dispute events, funds adjustments, receipts, reconciliation cases, invoice access links, customer sessions, documents, recurring schedules, recurring occurrences, reminder rules, reminder deliveries, email messages, suppressions, idempotency, rate limits, and audit events.
- **Tenant Isolation & Security**: Transaction-local tenant RLS on all tenant tables, non-superuser restricted runtime role, rate limiting, opaque sessions with 24-hour absolute and 30-minute idle timeouts, and cryptographic hashing/sealing.
- **Identity & Access Management**: Vendor Owner signup, login, email verification, Owner OTP login, password recovery grant workflow, password change, and staff session introspection/revocation.
- **Creator Management**: Atomic 5-active and 15-existing limit enforcement under vendor row lock, Owner-managed password resets, freeze/unfreeze, and clean deletion/historical authorship retention.
- **Vendor Onboarding & Change Requests**: Profile drafts, submission for platform review, Platform Owner review (`APPROVE`, `REJECT`, `MORE_INFO`), and sensitive change approval workflow.
- **Catalogue & Invoices**: Customer directory, catalogue products/services, GST tax profiles with rate components, invoice line calculation engine with discounts and taxes, invoice draft preparation, Creator submission, Owner rework requests, rejection, approval and issuance with 10-quota/month enforcement, sequential numbering (`INV-YYYY-XXXX`), immutable revision history, recipient email correction, and cancellation.
- **Customer Access & Payments**: 5-day hashed invoice access links, email OTP verification producing fixed 15-minute customer sessions, link renewal (including after full payment), document viewing/streaming, test payment attempts (UPI / QR), Razorpay webhook processing with deduplication, verified ledger recording, excess payment handling, and receipts.
- **Financial Exceptions & Ledger**: Manual test payment recording, payment allocations, full allocation reversals, manual payment reversals, draft and issued credit notes, dispute tracking, and reconciliation case resolution.
- **Automation & Background Worker**: Leased outbox jobs with exponential retry backoff, local preview mail delivery, PDF generation, recurring draft schedules, and reminder rules.
- **Web App**: Full Next.js client featuring Vendor Owner Workspace, Invoice Creator Workbench, Platform Owner Console, and Public Customer Payment Portal (`/pay/[token]`).
- **Mobile App**: React Native Expo mobile shell supporting API connection, Owner & Creator mobile login with bearer sessions, invoice overview, draft preparation, and creator tracking.
- **Verification**: `npm run typecheck` passes cleanly across all 6 workspaces; all unit, HTTP boundary, crypto, and calculation tests pass; Next.js production build succeeds.
