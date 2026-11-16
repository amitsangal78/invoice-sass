# Invoice SaaS — project and conversation handoff

Saved: 16 November 2026. This document preserves the available conversation context before deletion of the chat “Run invoice-sass end-to-end tests”. It is a handoff, not proof that pending code has been installed or tested.

## Latest objective and working preferences

Finish invoice layouts based on the reference files in the project's `invoices` folder, and generate course certificates with invoice issuance. Support two certificate styles: NamasteDev and Udemy. The user explicitly chose certificate availability “with invoice”; do not impose a payment or course-completion gate. Completion wording is a separate issuer choice.

The user wants functionality completed first and will perform the end-to-end flow testing afterward. Provide actual screen-by-screen business flows rather than a catalogue of test cases. Continue independently on routine implementation choices; avoid repeatedly asking for confirmations already given.

## Workspace and architecture

- Configured workspace `/Users/amitsangal/Desktop/invoice-sass` does not currently exist.
- Actual project verified at `/Users/amitsangal/Desktop/chatGPT/invoice-sass`.
- Actual project is outside this chat's writable roots; modifying it requires an approved elevated command. Read-only inspection is allowed. Do not recreate an empty project at the stale path.
- Pending invoice/certificate work is staged at `/private/tmp/invoice-documents-feature`. It has NOT yet been installed in the actual project. Temporary folders can disappear; preserve this staging tree before cleanup or reboot.
- Architecture: Next.js web app, Express API, PostgreSQL, background worker, Expo mobile, shared workspace packages.
- Node 22.15 is available under `/Users/amitsangal/.nvm/versions/node/v22.15.0/bin`.
- Use explicit valid working directory, `/bin/bash`, and `login:false` for shell commands because the configured cwd is stale.
- Read applicable AGENTS.md instructions before changes; web instructions require consulting bundled Next.js documentation. Do not overwrite unrelated changes, reset the repository, or commit without checking existing state.
- Do not spawn subagents unless explicitly requested or required by applicable instructions.

## Requested business flows and previous fixes

1. Vendor requests an account, completes onboarding, and submits the application. Admin reviews identifying information including registration email. Admin can approve, reject, or request more information with a reason. A draft application awaits submission; reviewers must not be left with only a Block action and no applicant identity.
2. Vendor manages products/services and tax profiles. Add Product/Service and Add Tax Profile forms were added after the user found no Add button.
3. Owner creates and directly issues an invoice. Creator creates a draft and submits it for Owner review; Owner approves and issues. Previous Owner submission restrictions were corrected in UI and API.
4. Customer receives/accesses an invoice, pays through Razorpay, and obtains a payment receipt. Payment callbacks and webhooks must be verified.
5. Invoice PDFs and course certificates use the requested layouts and remain accessible only to authorized staff/customers.

Previous implementation reported installed in the actual project: vendor review detail/actions, catalogue forms, corrected Owner/Creator permissions, Razorpay integration code, and email provider selection. Reinspect current files before relying on these claims.

## Payments

Razorpay Test Mode integration code exists: hosted Checkout, payment attempts/events, verified callbacks, signed webhooks, recovery handling, private receipt PDFs, and payment notifications. Key implementation areas include integrations/razorpay, paymentAttempts, and paymentEvents. Provider credentials were not configured at the last check. Code implementation does not imply a successful live payment or a completed Test Mode transaction.

Use test credentials and configure the matching webhook secret for verification. Never expose secrets in logs or this handoff.

## Emails

The user requested all of these with a dropdown to choose the provider:

- Local preview files (`.local/mail`). Verification codes can be read from captured messages there.
- LocalStack SES emulation for local capture; it does not by itself deliver to real inboxes.
- AWS SES for actual delivery, subject to the configured account's verified identities and sandbox restrictions.
- Resend for actual delivery using its credentials and domain configuration.

Shared `@invoice/email` code and persisted integration settings were implemented; local preview was the default at the last check. Real inbox delivery was not validated. SES/Resend bounce callbacks were not implemented at that point.

## Databases and prior verification

PostgreSQL was running locally on port 5432. Development database: invoice_dev; test database: invoice_test. Runtime development role: invoice_app. Migration/test commands use their configured administrative connection. Keep credentials in local environment files; never print them.

Migrations 001–004 were previously applied to development and test databases. The test database command resets invoice_test; never point it at development. Earlier work had passing builds and 24 database checks before the pending document feature. Those results do not validate the staged changes below.

Historical user questions included login 401 responses, database selection, local verification codes, draft approval, and missing catalogue controls. Do not treat the sample login credentials from old messages as authoritative current account credentials.

## Invoice and certificate references

References in the actual project's `invoices` folder include a dark course invoice, a NamasteDev certificate image, retail/book invoices, telecom/service invoices, and the newly added Udemy tax invoice named `Tax Invoice final.pdf`.

The Udemy invoice has separate HSN, quantity, taxable value, CGST, SGST/UGST, IGST, and total columns. The NamasteDev certificate reference uses navy/gold decoration, an orange certificate heading, learner/course details, signatures, and a unique ID.

An exact Udemy certificate reference had not been supplied at the last inspection. The staged implementation has a separate light Udemy-style certificate. Check for newly added references before refining it. Use the actual vendor's identity and entered instructor data; do not copy another issuer's signatures or falsely imply its authorization.

## Pending implementation in the staging tree

### Shared document rendering

New `packages/documents` package (`@invoice/documents`) uses PDFKit and embedded Noto Sans fonts. It exports invoice and certificate rendering, invoice document options, and certificate detail types. Invoice templates: STANDARD, COURSE, UDEMY, SERVICE. Certificate styles: NAMASTEDEV, UDEMY. Wording types: COURSE or COMPLETION.

Rendering includes actual invoice snapshots, customer/seller details, item HSN/SAC, tax totals, amount in words, optional order/shipping/service information, wrapping, and pagination. The WOFF font support and visual layout still require verification using the actual installed renderer.

### Database and contracts

Pending migration `005_invoice_templates_certificates.sql` adds invoice document options, COURSE_CERTIFICATE document kind, certificate number/index, and a unique index for certificates per revision/index. Apply additively; do not reset development data.

Shared contracts validate template options, dates, certificate details, and certificate lists (maximum 20). Item snapshots now carry HSN/SAC. Readiness and database integration setup were updated to require/apply migration 005.

### API

Invoice create/update/revision paths preserve document options in immutable invoice snapshots. Added PDF preview endpoints, staff document listing, and an Owner-only certificate request endpoint for existing issued invoices. Supplemental requests use request keys and request hashes for idempotency and enqueue encrypted certificate data. Existing invoice authorization and tenant boundaries remain relevant.

Relevant routes include POST `/api/v1/invoices/preview-invoice`, POST `/api/v1/invoices/preview-certificate`, POST `/api/v1/invoices/:id/certificates`, and GET `/api/v1/invoices/:id/documents`. Validate exact route and payload behavior against staged code before documenting it as available.

### Background worker

Invoice jobs use the new renderer, generate automatic certificates from the issued revision, and persist private documents. Existing issued invoices can receive supplemental certificates without changing financial history. Stable document IDs/revision indexes support retries. Receipt rendering remains on the prior renderer.

### Web app

Invoice creation has a layout dropdown, optional invoice metadata, certificate fields, wording/style/date choices, and inline PDF previews. Course/Udemy choices enable their associated certificate settings. Invoice details show documents and provide Owner access to add a certificate to an existing issued invoice. Customer invoice/payment pages poll for and display private certificate downloads independently of payment status.

Existing E2E selectors were adjusted for the new form controls; no full flow test was run for this staged work. Mobile-specific template/certificate creation UI was not implemented in this pending scope.

## Required next steps

1. Verify the actual project and staging paths; inspect any new reference files and applicable instructions.
2. Review staged changes, particularly SQL placeholder counts, API authorization, worker retries, JSX, and font resolution. Back up originals before installation.
3. Copy only intended changed files from staging into the actual project using approved access. Do not overwrite the real package-lock with the stale staged copy. Install the document dependencies in the actual project to update its lockfile.
4. Run appropriate type checks and builds. Fix compilation errors. Do not claim previous checks validate these new changes.
5. Apply migration 005 to development without resetting data.
6. Generate realistic sample PDFs through the real renderer and inspect both rendered pages and extracted text. Check all invoice layouts and both certificate styles, long text, taxes, and pagination.
7. Review existing PDF tests: raw byte searches for customer names/totals may fail with embedded-font PDFKit output. Update verification meaningfully instead of weakening financial checks.
8. Give the user concise screen-by-screen instructions for registration/approval, catalogue setup, Owner issuance, Creator review, customer payments, email selection, invoice templates, and both certificate flows. Clearly distinguish configured services from unconfigured credentials.

## PDF tooling and visual verification notes

The PDF skill was read and announced in this chat. Read its current instructions when resuming. Its artifact-operation-start marker was already successfully called once for this work (create, expected five PDF outputs); do not repeat that marker for the same operation.

Bundled Python with PDF libraries: `/Users/amitsangal/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`.

Reference PNGs were rendered under `/private/tmp/invoice-document-reference`. Poppler requires `FONTCONFIG_FILE=/private/tmp/invoice-fonts.conf` in this environment to avoid a fontconfig error loop. That config points to `/System/Library/Fonts` and `/Library/Fonts`, with cache under `/private/tmp/invoice-font-cache`. Recreate the config if temporary files disappear. Use actual output PDFs, render pages, inspect PNGs, and correct layout issues before claiming visual completion.

## Resume prompt

Read this handoff, inspect the actual repository and staged changes, then finish the invoice-template and course-certificate feature. Preserve existing functionality and development data. Certificates must be generated with invoice issuance, with NamasteDev and Udemy styles. Complete type/build checks and visual PDF verification, then explain the actual UI flows. The pending code has not yet been installed or verified.
