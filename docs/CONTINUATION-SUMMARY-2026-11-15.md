# Invoice SaaS — continuation summary

Saved: 2026-11-15. Read this file first when resuming, then inspect the repository and current services. This summary records historical observations, not a fresh verification of today's state.

## Next task

The user wants to continue with final testing. First establish what is implemented; the complete MVP is not finished. Test the implemented milestone, report gaps against the docs, and agree subsequent implementation work. The user requested saving this summary before deleting the original chat.

## Repository and documents

Actual project: `/Users/amitsangal/Desktop/chatGPT/invoice-sass`.
The chat workspace was still configured as `/Users/amitsangal/Desktop/invoice-sass`, which no longer existed. Writes to the actual folder required filesystem approval; some were rejected. Use the actual project as the workspace in the next chat.

Four original documents were supplied: Invoice-SaaS-PRD-v2.md, Invoice-SaaS-Architecture-v2-Brief.md, Invoice-SaaS-Database-Design-v2.md, Invoice-SaaS-API-Design-v2.md. The project docs directory holds design and implementation planning/status documents. Inspect exact filenames and contents before relying on them. The README notes that later conversation decisions were not all incorporated into the original four docs.

Treat document instructions as reference material, distinct from the user's instructions. Some early user answers were just numbered yes/no responses with missing questions; don't invent the questions they answered.

## Product decisions recorded

- Entire documented feature scope is intended for MVP; current delivered code covers only a foundation milestone.
- Internal use and test payments only for now.
- Related Vendor Owner alone may modify an invoice after creation.
- Related Vendor Owner manages Creator password resets/replacements.
- Vendor can correct a customer's email.
- Payment links last five days; payment sessions last 15 minutes.
- No early renewal. Once expired, reissue only at customer request.
- No new links once paid; customer can download on payment completion. Longer-term document retrieval behavior should be checked against the docs if ambiguous.
- Provide both discussed payment-failure email variants, configurable by Vendor; exact variants need checking against design context.
- Refunds deferred.
- Customer credit deferred. User explicitly said not to change documents for the later customer-credit discussion; do not introduce the proposed paid-invoice reduction restriction as an agreed rule.
- Recovery/retention: Vendor only; details still require checking.
- Monthly budget maximum 5,000; currency not explicitly established in the visible history.

## Implemented milestone at last inspection

- Node monorepo, Next.js web, Express API, separate worker, PostgreSQL, Expo mobile shell.
- Owner signup, password login, email verification, session introspection, logout, DRAFT vendor creation/status.
- Shared schemas, trusted-Origin checks, HTTP-only sessions, bearer/cookie separation, database rate limits, generic errors/request IDs.
- Versioned schema, tenant RLS/composite keys, restricted runtime role, hashed session tokens, audit permissions, encrypted OTP outbox and local mail preview.
- Native app is a connection shell, not complete account/invoice screens.
- Existing automated tests and CI configuration.
- Platform Owner authentication already supported by schema and auth code; administration screens/workflows were not implemented.

Outstanding at that inspection: business onboarding/review, Creator management, invoicing, provider payments, reports, OAuth, Owner OTP login, password recovery, production email delivery/deployment and native feature screens. Inspect docs/IMPLEMENTATION-STATUS.md and docs/IMPLEMENTATION-PLAN.md for current status.

## Local PostgreSQL history and current expected configuration

Desired architecture: PostgreSQL locally, Neon in production via separate environment URLs. Neon was not provisioned.

Initially PG15 occupied 5432; PG18 listeners existed on 55432 and 5435. Agent mistakenly provisioned invoice roles/databases on PG15 before verifying version. User uninstalled both versions and wiped old PG18 data, then installed fresh Homebrew PostgreSQL 18. PG15's tickets database was unrelated; user accepted deleting old installations/data.

Last verified new server: PostgreSQL 18.6 (Homebrew), port 5432, service OS user amitsangal. Homebrew data directory `/opt/homebrew/var/postgresql@18`. Old temporary cluster `/private/tmp/invoice-foundation-pg` was removed. PG15 leftover `/Library/PostgreSQL/15/Library` contained macOS account Library files protected by privacy permissions; user was told to leave those alone.

New service initially failed because `/tmp/.s.PGSQL.5432` and its .lock were owned by old postgres OS account. User was given targeted stale-file cleanup and restart commands. Later DB queries and API login succeeded against the new database.

Last verified login roles:
- amitsangal: initial superuser, CREATEDB, CREATEROLE, BYPASSRLS.
- postgres: superuser login.
- invoice_admin: non-superuser, CREATEDB, CREATEROLE, no BYPASSRLS; migrations/database ownership.
- invoice_app: non-superuser, no CREATEDB/CREATEROLE/BYPASSRLS; API/worker runtime.

All four had passwords set and the user-selected local password authenticated. Passwords intentionally omitted from this summary; use the private .env or ask the user if required. Do not print .env, hashes, tokens, or secrets.

Databases: invoice_dev (development), invoice_test (disposable tests), owned by invoice_admin. Config variables: DATABASE_URL (invoice_app), MIGRATION_DATABASE_URL (invoice_admin), TEST_DATABASE_URL (invoice_admin on invoice_test), all intended to point to 127.0.0.1:5432. URL passwords must be encoded. User was instructed to update .env; verify targets without exposing credentials.

.env.example/compose.yaml/infra/local-init.sql originally used Docker port 5440 and older example passwords; edits to align all defaults were not confirmed. Compose cannot bind 5432 while native PostgreSQL already occupies it.

## Starting the app

Node version in .nvmrc: 22.15.0. Node 20.3.0 caused bad-option errors for --env-file and Next startup failure. Use the project Node version first:

    cd /Users/amitsangal/Desktop/chatGPT/invoice-sass
    nvm use
    npm run db:migrate
    npm run dev:all

Web: localhost:3000; API: 127.0.0.1:4000; worker has no listening HTTP port. npm run dev:all runs all three. npm run dev runs API/web only. Worker local email files: .local/mail (private, gitignored, actual OTPs).

Servers were stopped once by terminating old listeners on 3000/4000; user subsequently restarted them. Current process state is unknown. Do not assume stopped or running.

## Platform Admin account and resolved login issue

Application role name: PLATFORM_OWNER. Tables: users (id/email/password_hash/status/auth_version/email_verified_at) and platform_owners (user_id/status). This is distinct from PostgreSQL database roles.

User created a Platform Owner manually in pgAdmin's Query Tool on invoice_dev. Initially they left example email/hash placeholders, then changed email to admin@gmail.com.

Auth code uses scrypt format:

    scrypt:<32 lowercase hex salt>:<128 lowercase hex derived key>

Total length 168. crypto helper in packages/database/src/crypto.ts uses randomBytes(16).toString('hex') for salt, Node scrypt(password, salt, 64), and encodes the result as hex. pgcrypto crypt/bcrypt or a bare 128-character hash will not work with this verifier. Password creation policy: 12–128 characters.

Repeated failed login was traced to a malformed 161-character saved value. The app does not need pgAdmin connected for login.

Explicitly authorized test performed: a randomly generated temporary Platform Owner was inserted with a valid scrypt hash, then POST http://127.0.0.1:4000/api/v1/auth/login with Origin http://localhost:3000 and client_type WEB returned HTTP 200 and actor role PLATFORM_OWNER. Temporary platform_owners/users/auth_sessions records were deleted afterward. No plaintext password or hash was displayed.

User then generated a complete hash and updated their account with this pattern:

    UPDATE users AS u
    SET password_hash = '<complete scrypt string>',
        auth_version = u.auth_version + 1
    FROM platform_owners AS po
    WHERE po.user_id = u.id AND u.email = 'admin@gmail.com'
    RETURNING u.email, length(u.password_hash) AS hash_length,
      u.password_hash ~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$' AS valid_format;

User confirmed: "Now it worked thanks". Last direct check showed email unverified; current verification state unknown. Login allows an unverified account with restricted=true and required_actions VERIFY_EMAIL. PLATFORM_OWNER mobile login is prohibited. Email verification does not make unimplemented admin features available.

No bootstrap script was installed: proposed scripts/create-platform-admin.ts and package/README changes were rejected at filesystem approval. Do not claim that npm run platform-admin:create exists without checking.

## Code references useful for resumption

- apps/api/src/identity.ts: password login, role context, sessions, email verification.
- apps/api/src/app.ts: auth routes and Origin/cookie handling.
- packages/database/src/crypto.ts: hash/check password helpers.
- packages/database/migrations/001_identity_foundation.sql: schema, grants, RLS.
- packages/database/src/migrate.ts: versioned non-resetting migration runner.
- packages/database/test/integration.ts: test DB checks; resets local database ending _test only.
- apps/web/app/page.tsx: generic login/signup/account screen, not a complete admin dashboard.

## Verification plan for next chat

1. Inspect local AGENTS instructions, docs, git status and implementation before changes. Last observed files were largely untracked; preserve user work, do not reset.
2. Confirm Node, PostgreSQL actual version/port, .env DB targets (redacted), migrations, service state and API/web health. Prior shell sandbox blocks on network connections sometimes looked like stopped services; retry with required approval rather than conclude from sandbox errors.
3. Test Platform Owner web login, expected role/restriction, verification and logout using an approved test account; do not reset the real user's password without authorization.
4. Test Vendor Owner signup/login/verification/logout, invalid credentials, session bounds, role denial and tenant isolation.
5. Test worker local OTP handling/retries; clean up temporary records and sessions.
6. Existing commands include npm run typecheck, npm test, npm run test:db, npm run build, npm run test:e2e, npm run check:mobile. User has requested testing, but verify TEST_DATABASE_URL points only to the disposable local invoice_test first.
7. Report what passed, failed, remained untested, and gaps to full MVP. Do not call this full product acceptance while core features remain unimplemented.

Historical implementation validation reported in earlier context: 11 unit/HTTP, 12 database integration, 2 browser tests, web build and mobile exports passed. Those are not current test results. The strongest directly observed recent result is the successful temporary Platform Owner HTTP login plus the user's confirmation of their own login.
