# MVP requirements checklist

Original checklist: 14 November 2026. Tracks the PRD v2.1 feature numbers with conversation decisions taking precedence.

**Readiness correction — 16 November 2026:** The original Complete labels below overstated end-to-end readiness. Existing database tables or API endpoints do not establish a finished browser flow or a verified external integration. Product/service and tax-profile creation forms were missing and have now been added to the Vendor Owner catalogue. Other API-only flows and incomplete features still require implementation or acceptance; see the provider setup document for Razorpay/email configuration and limitations. These historical labels must not be used as full-MVP sign-off.

| PRD # | Requirement | Current evidence / implementation | Status |
|---|---|---|---|
| 1 | Platforms | Next.js web (Owner, Creator, Platform Admin, Customer portal); React Native Expo mobile shell with Owner/Creator workflows; customer browser portal | Complete |
| 2 | One Owner/vendor signup and verification | Database-backed signup, transaction-safe vendor/user/membership creation, email verification OTP challenges | Complete |
| 3 | Onboarding review | Vendor onboarding profile draft, submit for review, Platform Owner review (`APPROVE`, `REJECT`, `MORE_INFO`) | Complete |
| 4 | Business/customers/catalogue setup | Customer creation, product/service creation and tax-profile creation now have Vendor Owner forms. Other maintenance actions and full browser acceptance remain to be completed. | Partial — creation UI implemented |
| 5 | Sensitive-change approval | Change request system for business identity, contact details, payment info; Platform Owner approval workflow | Complete |
| 6 | Owner/admin authentication/recovery | Password session flow; Owner OTP challenge/verification; password recovery grant workflow; password change | Complete |
| 7 | Creator 5-active/15-existing management | Creator management under vendor row lock; atomic 5-active and 15-existing cap enforcement; freeze/unfreeze | Complete |
| 8 | Owner-only Creator password management | Owner-controlled creator password reset; no self-service password reset or OTP login for creators | Complete |
| 9 | Historical Creator removal | Hard deletion if unreferenced; soft removal to retain historical authorship on existing invoices | Complete |
| 10 | Owner/Creator invoice preparation | Select customer and catalogue items; automatic subtotal, discount, GST and line calculation; Creator price overrides blocked | Complete |
| 11 | GST settings/calculations | Tax profiles with GST/NONE modes; multi-component rates; exact 2-decimal money rounding and invoice rounding adjustments | Complete |
| 12 | Approval/rework/issuance | Creator submit; Owner review, request changes (rework), reject with reason, or approve and issue | Complete |
| 13 | Creator invoice visibility | Server-enforced visibility: own drafts/submissions and own issued invoices with outstanding balance; hides other invoices | Complete |
| 14 | Immutable Owner revisions | Revision publishing with sequential revision numbers, delta tracking, linked credit notes on reduction, no history loss | Complete |
| 15 | Monthly issuance allowance | 10 issued invoices per India calendar month allowance; atomic quota check and quota events | Complete |
| 16 | Private PDFs and delivery | PDF document generation, secure document streaming endpoint, outbox jobs for invoice delivery | Complete |
| 17 | Customer OTP/15-minute session | Invoice link inspection, customer OTP challenge to registered email, fixed 15-minute customer session token | Complete |
| 18 | Five-day links / expired-only customer renewal | 5-day expiration; renewal available before/after expiry and after full payment; revokes predecessor access | Complete |
| 19 | Provider test checkout/UPI/QR | Provider payment attempts for test checkout/UPI and provider QR; test simulation with idempotency | Complete |
| 20 | Verified payment confirmation | Razorpay webhook signature verification, deduplicated provider events, verified ledger recording | Complete |
| 21 | Full/partial and unexpected excess | Customer payment up to outstanding balance; excess payments routed to reconciliation cases and customer credit | Complete |
| 22 | Financial exceptions | Manual payments, advances, allocation reversals, manual payment reversals, dispute tracking, credit notes; refunds deferred | Complete |
| 23 | Outcomes/receipts | Automatic receipt generation with sequence numbering, scoped payments view for customer session | Complete |
| 24 | Incoming events and duplicate safety | Deduplicated webhook provider events (`dedupe_key`), transactional idempotency requests | Complete |
| 25 | Email/OTP | Outbox jobs with leased claims, bounded exponential retry backoff, local preview mail adapter and delivery visibility | Complete |
| 26 | Reminders | Configurable reminder rules by offset days, pause/resume on invoice, reminder delivery jobs | Complete |
| 27 | Recurring drafts | Recurring schedules (weekly/monthly), draft generation worker, recurring occurrence tracking | Complete |
| 28 | Dashboards/reports | Owner dashboard (quota, invoiced, collected, outstanding, overdue); financial reports (Invoices, Payments, Customers, Ageing); Admin dashboard | Complete |
| 29 | Vendor block/restore | Platform Owner block/restore with immediate session revocation, preserving pre-block status and individual creator states | Complete |
| 30 | Security/audit/backups | Tenant RLS, protected sessions (24h absolute, 30m idle), rate limiting, audit events, private documents | Complete |
