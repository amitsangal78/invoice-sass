# Invoice SaaS — MVP implementation plan

27 October 2026 · Proposed execution plan against the four v2.1 design documents.

## Starting point

The local invoice-sass folder currently contains the design documents only. There is no application scaffold, package configuration, migration or local Git repository. This plan does not claim implementation, provider verification, deployment or cost validation is complete.

## Scope and delivery rule

Web, Android and iOS, all agreed business workflows, test payments, advances, credits, disputes, reconciliation, automation, reporting, administration and recovery remain MVP requirements. Refund mechanisms are deferred. Milestones sequence delivery; they do not redefine a partial build as the finished MVP. The earlier 54-hour target is a progress checkpoint. All money is simulated; no live collection is enabled.

Operating costs must remain within INR 5,000 per month. Obtain a current estimate covering hosting, database, files, email, secrets, monitoring, backups and related service charges before provisioning. Separate any one-time or distribution costs from recurring infrastructure estimates and discuss them before spending.

## 1. Resolve policies and verify external dependencies

- Prepare a decision sheet for GST cases, inclusive/exclusive prices, rounding stage/method, numbering periods, backdating and statutory correction rules. These remain unapproved; use explicit test examples while designing the calculation engine.
- Prepare options for vendor-data retention, backup frequency, acceptable data loss and restore time. Verify provider capabilities and costs before proposing commitments.
- Verify supported Razorpay test checkout/UPI/QR and dispute scenarios. Record which cases use verified provider tests and which require clearly labelled fixtures. Refund implementation is excluded.
- Check access/readiness for Neon, AWS EC2/S3/SES/SNS, sender identity/domain and Google login configuration. Record configuration requirements without putting secrets in the repository.
- Confirm how internal Android/iOS builds will reach testers. Public store publication is a separate release action, not assumed by this plan.
- Turn PRD acceptance into a traceable checklist mapping each requirement to API, database, web/mobile coverage and verification.

**Exit:** Policy choices are recorded or clearly identify the feature they block; provider capability evidence and operating cost estimates are available. Independent local foundation work may proceed while these items are resolved.

## 2. Build the local foundation

- Initialize local Git and project documentation; decide the remote destination before creating or publishing a remote repository.
- Scaffold TypeScript applications for Next.js web, Express API, backend worker and React Native mobile. Share API contracts, validation and calculation logic where appropriate; keep secrets and server permissions in the backend.
- Add local database/development configuration, environment examples, migration tooling, formatting/type checks and automated CI checks.
- Write executable API schemas from the descriptive API contract; reconcile types, statuses, revision fields and disabled refund scope with migrations.
- Implement database roles, transaction-local tenant context, tenant-safe foreign keys and RLS from the beginning.
- Establish structured logs, redaction, request correlation, private file abstraction and the transactional job mechanism needed by OTP/email flows.

**Exit:** Web and mobile development shells can call the local API; the database builds from migrations; CI passes; a focused cross-tenant test proves isolation. No paid infrastructure is required merely to scaffold locally.

## 3. Deliver identity and vendor administration

- Owner signup, email verification, password/OTP/Google login and account recovery; separately provisioned Platform Owner access.
- Staff session expiry after 24 hours or 30 minutes idle; secure web cookies/mobile storage and immediate revocation on relevant changes.
- Onboarding approval/rejection/more-information flows and pending-vendor restrictions.
- Creator creation, Owner-only password replacement, freeze/unfreeze/removal and atomic five-active/fifteen-existing limits. No Creator password-change or recovery route.
- Sensitive-change requests with new-email verification, preservation of active values, and Platform Owner decisions.
- Vendor block/restore preserving prior approval lifecycle and individually frozen Creator states.
- Implement the corresponding Owner/Creator mobile screens as these API capabilities become available.

**Exit:** Owner, Creator and Platform Owner journeys work with authorization tests; concurrent Creator management cannot exceed limits; revocation applies on web/mobile.

## 4. Deliver the invoice and document journey

- Customers, catalogue and tax profiles, with Creator dropdown-only access.
- Calculation engine using approved policy fixtures; exact decimals, Owner overrides and Creator quantity-only edits.
- Draft, submission, rework, rejection, approval/issuance, numbering and ten-per-India-month quota.
- Immutable issued revision snapshots and PDFs; Owner-only revisions, separate replacements, cancellation and original authorship/history.
- Credit-note integration for reductions without double counting; retain excess customer credit rather than refunding it.
- Private PDF generation, retry visibility and protected invoice delivery.
- Audited customer email correction, including revocation of prior links, OTP challenges and sessions.
- Five-day customer links, OTP and fixed 15-minute sessions; renewal and downloads remain available after full payment.
- Owner/Creator mobile invoice workflows and permission restrictions.

**Exit:** A Creator prepares an invoice, Owner issues it, customer views/downloads after OTP, and Owner can revise it without losing history. Retried issuance creates one number/quota event; expired/revoked access fails.

## 5. Deliver collections and financial exceptions

- Supported test payment attempts for full/partial amounts; prevent competing unresolved attempts and reject payment while outstanding is zero.
- Verified durable provider ingress, independent event/payment deduplication, delayed/out-of-order processing and reconciliation.
- Confirmed payment ledger, allocations, receipts and distinct customer/Owner notifications.
- Manual test records, advances, overpayments/customer credit and Owner-controlled allocation corrections.
- Supported or labelled-fixture disputes, chargeback evidence and explicit reconciliation resolution.
- Paid/part-paid invoice revisions preserve payments/receipts; reductions release excess allocations into credit; increases update debt without fabricating money.
- Mobile collections views within agreed role permissions; customer payment remains a browser journey.
- No refund endpoint, UI action or worker mechanism is enabled.

**Exit:** Duplicate, partial, excess, unknown and late outcomes preserve funds evidence and correct balances; session expiry/vendor blocking cannot discard valid in-flight confirmations. Cross-invoice receipts do not leak unrelated information.

## 6. Complete automation, reports and operations

- Recurring Owner drafts, occurrence deduplication and restart behaviour.
- Configurable reminders, pause/resume, current-balance checks and no reminders for ineligible invoices.
- Owner dashboards, customer/payment/invoice/ageing reports and traceable calculation definitions.
- Platform review/activity dashboards, failed jobs, provider-event reprocessing, email outcomes and suppression remediation.
- Retry/dead-job visibility and safe worker restart; email acceptance is distinguished from delivery.
- Automated backups and an audited vendor-data restore procedure with tenant isolation, preserved ledger/deduplication history, revoked restored tokens and reconciliation before job resumption.
- Finish and verify every agreed Owner/Creator workflow on both Android and iOS; mobile is part of MVP completion, not a later optional phase.

**Exit:** Automation retries do not duplicate business effects, reports reconcile to the ledger, and a restore rehearsal meets the approved recovery targets.

## 7. Release the internal MVP

- Complete role/tenant/customer access, concurrency, financial reconciliation and worker-failure checks as each module is built; run final end-to-end checks across web, Android and iOS.
- Review current hosting/service estimate against the INR 5,000 ceiling, then configure the approved test environment and CI/CD deployment.
- Verify HTTPS, private files, secrets, test-mode boundaries, monitoring, migrations, backup availability and deployment rollback behaviour.
- Distribute internal builds and run the agreed 5–10-vendor pilot using simulated money and test-labelled documents.
- Track defects and unresolved delivery/payment failures; do not declare unsupported provider features integrated or any full-MVP requirement complete without evidence.

**Completion:** All agreed non-refund features pass the requirement checklist across their intended platforms. Detailed tax/recovery policies and external configuration gates are resolved for the enabled use. No live-money capability is enabled.

## Immediate next work

1. Prepare the small policy decision sheet and requirements checklist.
2. Verify external test capabilities and prepare a current budget estimate.
3. Start the local foundation while independent decisions are pending.

Estimate milestone dates after the foundation and first working identity flow establish actual delivery speed; avoid treating the 54-hour progress target as a complete-MVP estimate.
