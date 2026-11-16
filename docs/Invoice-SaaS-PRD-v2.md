# Invoice SaaS — Brief PRD
**Version 2.1 · 27 October 2026 · Product Owner: Amit Sangal**

## Agreed baseline — 27 October 2026

- Internal learning/testing MVP using simulated money only. All agreed web, Android and iOS features remain in the MVP; the refund mechanism is explicitly deferred. Delivery may be sequenced, but milestones do not remove agreed scope. Two weeks (~54 hours) is a progress checkpoint, not full-MVP completion acceptance.
- Monthly operating budget ceiling: **INR 5,000** across hosting, database, storage, email, backups and related operating services. Validate estimates before provisioning; no service tier or recovery target is assumed to fit without checking.
- One nonremoved vendor membership per login identity. One Owner/vendor; up to five active and fifteen existing Creators. Current ten-issued-invoices/month quota remains for internal testing; a separately issued replacement consumes quota and cancellation does not restore it.
- Only the related Vendor Owner can reset/replace Creator passwords. Creators have no password-change, initial-password-replacement, recovery, OTP-login or Google-login capability. Email verification remains separate from login.
- Creators retain their agreed own-draft/rework preparation rights. After issue, only the related Vendor Owner may modify an invoice, through a new immutable revision. Preserve original authorship, all prior snapshots/PDFs, payments and receipts. Reducing the collectible amount below allocations releases excess to customer credit; refunds are deferred.
- Sensitive fields requiring Platform Owner approval: legal business name, GSTIN, registered address, login email, contact email/mobile and payment details. Existing approved values stay effective pending approval; verify ownership of a changed email. Routine catalogue, price and tax-default settings remain Vendor Owner managed.
- Vendor Owner may correct customer email through an audited invoice-recipient correction; preserve historical recipient snapshots, revoke prior links/sessions, and send new access to the corrected recorded address. Changing the customer master alone does not silently rewrite issued history.
- Customers may request a fresh invoice link **including after full payment**. Each new link lasts **five days**; email OTP grants a fixed **15-minute session**, subject to earlier link expiry/revocation or eligibility loss. Renewals revoke prior access and are rate-limited/coalesced. Paid invoices remain viewable/downloadable; payment is offered only while outstanding is positive.
- Staff sessions: 24-hour absolute expiry and 30-minute idle timeout; no remember-me initially. OTP/reset-code validity remains five minutes; it is distinct from the customer session duration.
- Both Vendor Owner account recovery and vendor business-data backup/restore are required. Creator recovery remains Owner-controlled. Tenant-safe restore must preserve financial evidence and safely resume jobs without duplicate business effects.
- Still open: GST applicability, inclusive/exclusive pricing, rounding, numbering, backdating/correction policies; backup retention, acceptable data loss (RPO) and recovery time (RTO). These require explicit resolution before affected release/use; no specific values are approved here.

**Goal:** Help Indian vendors create invoices and automate collection tracking, receipts and follow-up so they can focus on their business.

**Current delivery:** Learning-first pilot using the platform owner's Razorpay test account and simulated money. All agreed features below are MVP requirements except refunds, which are deferred; two weeks (~54 hours) is a progress checkpoint, not a commitment to finish the MVP. Initial users: 5–10 vendors, growing towards 50. Free initially; subscriptions later.

**Authority:** This revised PRD incorporates the decisions agreed on 27 October 2026 and supersedes earlier conflicting requirements. The companion architecture, database and API documents are updated to the same baseline; filenames retain v2 for continuity.

## Feature overview — agreed requirements

| # | Feature | Owner / user | Required behaviour |
|---|---|---|---|
| 1 | Platforms | Vendor Owner, Invoice Creator, Platform Owner, Customer | Vendor web + Android/iOS apps; Platform Owner dashboard on web only; customer browser page, no app installation required. |
| 2 | Vendor signup | Vendor Owner | Create one owner account and business; email/password with email verification or Google signup. No creator account automatically created. |
| 3 | Onboarding approval | Platform Owner | Approve, reject with reason or request more information. Owner can log in to complete onboarding/check status before approval; issuing invoices requires approval. |
| 4 | Business setup | Vendor Owner | Maintain business details, customers, product/service catalogue, prices, GST defaults and payment information. Vendor Owner may correct customer email through the audited invoice-recipient workflow. Creator selects existing records only. |
| 5 | Sensitive changes | Vendor Owner → Platform Owner | Legal business name, GSTIN, registered address, login/contact email, contact mobile and payment details require Platform Owner approval; verify new email ownership. Existing approved values remain active pending approval. |
| 6 | Owner authentication | Vendor Owner / Platform Owner | Email/password and self-service password recovery; Vendor Owner also supports email-OTP and Google login. Platform Owner is provisioned separately, with no public admin signup and no MFA initially. |
| 7 | Creator accounts | Vendor Owner | Create/manage up to **5 active and 15 existing creators** per vendor. Frozen accounts count towards 15. Activation/unfreeze must respect the five-active limit. |
| 8 | Creator passwords | Vendor Owner / Invoice Creator | Password-only login. Only the related Vendor Owner sets, resets or replaces a Creator password; communicate it securely. No Creator self-change, initial-password replacement, OTP/Google login or self-service recovery. Owner can freeze/remove access. Initial email verification is separate from login. |
| 9 | Creator deletion | Vendor Owner | Delete unreferenced accounts physically. Where history exists, remove credentials/access and managed-account entry, retaining minimal historical authorship. Both free a slot; retained history does not count towards 15. |
| 10 | Invoice preparation | Owner / Creator | Select customer/items; enter quantities using suitable controls; calculate totals automatically. Creator cannot override prices, discounts or GST. Owner can set permitted invoice-specific values. |
| 11 | GST | Vendor Owner | Vendor supplies tax information/settings. Invoice-specific owner settings override configured defaults. Keep GST identity separate from rates/calculations. |
| 12 | Approval and rework | Creator → Owner | Creator may edit before submission; submission locks editing. Owner edits and **approves and issues**, requests modifications for creator resubmission, or completely rejects with a reason. Owner-created invoices can issue immediately. |
| 13 | Creator visibility | Invoice Creator | Own drafts/submissions needing action and own issued invoices with unpaid/partially paid balances only. No other creator's, owner-created, recurring, fully paid or completely rejected invoices. |
| 14 | Invoice history/correction | Vendor Owner | Only the related Vendor Owner may modify issued invoices, including paid/part-paid invoices, by publishing an immutable revision; preserve original author, all prior snapshots/PDFs, payments and receipts. Release any excess allocations caused by a reduction into customer credit. Refunds are deferred. Separate replacement invoices remain linked and consume issuance quota. Rejected invoices leave creator view and notify the reason. |
| 15 | Free allowance | Vendor | **10 issued invoices per India calendar month per vendor**. Drafts/rejections do not count; issued recurring invoices count; cancellation does not restore quota. |
| 16 | PDFs and delivery | Owner / Customer | Generate private invoice PDFs and email protected links after issuance. Failed PDF/email work retries without issuing a duplicate invoice. |
| 17 | Customer access | Customer | No account/password. Invoice-specific link + email OTP grants a **fixed 15-minute session** for that invoice's details, documents and payment options. |
| 18 | Link expiry/replacement | Customer | Each new link is valid for **five days**. Customer may request a fresh link before/after expiry and after full payment, sent immediately to the currently recorded invoice email without Owner approval. Paid invoices permit viewing/downloads, with no payment action while outstanding is zero. Rate-limit/deduplicate; revoke old link and associated sessions. Blocked vendors/ineligible invoices cannot renew access. |
| 19 | Payment checkout / QR | Customer | Provider-backed invoice-linked UPI checkout/QR with automatic confirmation. An arbitrary vendor-uploaded QR cannot substitute for provider verification. Validate supported Razorpay test capabilities; unsupported scenarios use clearly labelled simulations. |
| 20 | Payment confirmation | System | Verify provider signature, merchant/reference, amount, currency and status. Record each payment once. Customer return screens or “I paid” claims never confirm receipt. |
| 21 | Full/partial payments | Customer / System | Full payment default; customer may choose a positive amount up to outstanding. Successful partial payment reduces balance; failed attempts do not. Preserve unexpected excess payments for reconciliation. |
| 22 | All financial cases | Vendor Owner / System | Include advances, overpayments/customer credit, disputes, failed/pending payments, corrections and reconciliation in the MVP. Full/partial refund mechanisms are deferred; retain credit without promising or initiating refunds. Owner controls adjustments; preserve immutable history. Cash/bank/manual recording remains a supplementary owner-controlled path, not the primary integrated UPI confirmation. |
| 23 | Payment outcomes/receipts | Customer + Vendor Owner | Notify both of confirmed success/failure; pending/unknown is not failure. Issue receipts for confirmed payments. Distinguish payment success from bank settlement; customer sees only their authorized invoice's payment information. |
| 24 | Webhooks and duplicates | System | Incoming provider events only. Handle duplicates, retries, delayed/out-of-order results and reconciliation. Frontend prevents repeat submissions; backend independently enforces idempotency/transaction safety. |
| 25 | Email and OTP | System | Amazon SES for OTPs, onboarding decisions, invoice review/rejection, invoice delivery, payment outcomes, receipts, reminders and blocking notices. Backend owns OTP verification/expiry; bounded retries and delivery-failure visibility. Email only initially. |
| 26 | Reminders | Vendor Owner / System | Configurable follow-up for issued outstanding invoices; Owner may pause. Recheck before sending; stop after full payment/cancellation. No overdue collection emails for unissued drafts. |
| 27 | Recurring invoices | Vendor Owner | Schedule recurring drafts; Owner reviews/issues each occurrence. Prevent duplicate drafts on retries. No automatic recurring debit. |
| 28 | Dashboards/reports | Owner / Platform Owner | Owner: approvals, invoiced/collected/outstanding/overdue amounts, customer/payment/ageing reports. Platform Owner: vendor reviews/status, sensitive requests, activity and operational failures. Vendor collections are not SaaS revenue. |
| 29 | Vendor block/restore | Platform Owner | Reversible soft deletion/block; notify by email. Block vendor/creator login, new invoices and new payment attempts. Retain history and process already-started payment confirmations. Restore without unfreezing individually frozen creators. |
| 30 | Security and audit | System | Enforce tenant, role and invoice-level access on backend. Private files, protected credentials/tokens, secure sessions, throttling, audit history and backups. Explicit server-owned created_at and updated_at where mutable; immutable financial/history rows retain created_at and event timestamps. Support Vendor Owner account recovery and tenant-safe vendor business-data backup/restore; retention/RPO/RTO remain to be agreed. |

## Core journeys

**Vendor:** Signup → email/identity verification → business setup → Platform Owner approval → manage up to five active creators.

**Invoice Creator:** Select customer/items → enter quantities → submit → Owner reviews → rework and resubmit, reject, or approve and issue.

**Customer payment:** Email link → OTP → 15-minute access → choose full/partial payment → supported test checkout/QR → verified provider confirmation → balance/receipt update → customer and Owner notified. Session expiry does not stop payment processing.

**Fresh link, including a paid invoice:** Request replacement → eligibility/rate-limit checks → fresh link emailed immediately to recorded recipient → OTP verification again. No requester-supplied replacement email.

## Release acceptance
- Enforce five-active/fifteen-existing creator limits atomically, including concurrent create/unfreeze requests.
- Creator restrictions, owner-only recovery and immediate access revocation hold across web/mobile and all login paths.
- No invoice/customer/payment data crosses vendor or customer-session boundaries.
- Approval/issuance, quota usage and payment recording remain single business effects under retries.
- Test payment outcomes, partial balances, excess payments, credits and disputes are traceable; unsupported provider cases are labelled simulations.
- Five-day links and 15-minute sessions expire correctly; renewal cannot bypass vendor blocking.
- Only the related Owner publishes issued revisions; originals/authorship/payment evidence remain intact, reductions release excess credit without refunds, and scoped receipts do not reveal other invoices.
- Paid invoices can renew links and download documents after OTP; zero outstanding prevents new payment attempts.
- Customer email corrections revoke old access and preserve history; Creator password changes are exclusively Owner-controlled.
- Vendor Owner account recovery and vendor-data restore are verified; restore cannot leak another tenant or duplicate payments/jobs.
- All agreed web/Android/iOS workflows are MVP acceptance requirements; refunds are excluded.
- Notify and retry reliably; show unresolved delivery/payment failures instead of silently declaring success.

## Delivery boundaries and implementation gates
**Agreed technical direction:** Next.js/React, Node.js/TypeScript modular monolith, Neon PostgreSQL in Singapore, EC2, React Native, SES and private S3 storage. Git-based development. Downtime acceptable initially.

**Not in this phase:** Refund mechanisms, real vendor-money collection, live merchant onboarding/settlement, subscriptions, outgoing integration webhooks, WhatsApp/SMS, full accounting/inventory, or automatic recurring debits.

**Resolve in implementation before affected live use:** Supported provider test scenarios; detailed credit/dispute/revision transition rules (refund implementation is deferred); validated GST/rounding/numbering/correction rules; retention and backup recovery targets; production sender/payment approvals. These are implementation gates, not exclusions of the agreed financial feature scope. No provider/test limitation should be disguised as completed integration.

**Scope change note:** This revision replaces prior five-minute customer sessions, any no-renewal-after-payment rule, Creator initial/self password replacement, and refund-in-MVP requirements. All other agreed MVP features remain required. Tax and recovery policy values remain open. Monthly operating ceiling is INR 5,000.

