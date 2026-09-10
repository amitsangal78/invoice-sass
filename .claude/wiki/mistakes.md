# Mistakes log

Real bugs hit while building this project, each as: what happened → root cause → fix → how to avoid it next time. Read the relevant entries before touching an area listed below; append a new entry whenever a non-obvious bug is found and fixed (see `.claude/rules/ai-context-workflow.md`) — a corrected assumption that isn't written down gets rediscovered the hard way later.

## Invoice numbering was off by one

**What happened**: the first invoice created in a new workspace was numbered `INV-2026-0002`, not `0001`.
**Root cause**: `generateInvoiceNumber()` does `UPDATE invoice_sequences SET next_number = next_number + 1 RETURNING`. The `invoice_sequences` row is provisioned once per workspace, and the column's own schema default is `nextNumber: 1` — so the very first increment took it from 1 to 2.
**Fix**: provision the row explicitly at `nextNumber: 0` on first creation, so the first increment correctly lands on 1.
**Avoid next time**: any "counter that increments on read" pattern — check whether the *provisioning* default and the *increment* logic agree on which one owns "start at 1."

## Workspace suspension didn't take effect immediately

**What happened**: after a `SUPER_ADMIN` suspended a workspace, its existing members could keep working for up to 15 minutes.
**Root cause**: `resolveWorkspace`'s Redis-cached permissions entry (`workspace:{id}:permissions:{userId}`) includes `isSuspended`, but suspending a workspace only updated Postgres — the cache wasn't invalidated, so already-cached members read stale (non-suspended) data until their TTL expired.
**Fix**: added `invalidateCachePattern()` (`lib/redis.ts`, `SCAN`-based, non-blocking) and call it on suspend/reactivate to invalidate every cached member's entry for that workspace at once, not just one known key.
**Avoid next time**: any action that changes a value embedded in a *cached* object (not just a directly-cached value) needs its own invalidation call — caching `isSuspended` as part of a larger cached object made it easy to forget that a suspend action needs to bust that cache too.

## Three Postgres instances on one machine

**What happened**: `DATABASE_URL` connections intermittently failed with "no password supplied" even though trust auth was supposedly configured.
**Root cause**: this machine has a pre-existing system PostgreSQL 15 (unrelated to this project) already bound to port 5432, plus Docker's dev/test Postgres on 5434/5433 — three separate instances total. Assumptions about "the Postgres on 5432" were wrong; that port belonged to the pre-existing system install, not this project's.
**Fix**: reconfigured Homebrew's `postgresql@18` to run on port 5435 instead, avoiding all three existing occupants. See [infrastructure.md](infrastructure.md) for the full topology.
**Avoid next time**: never assume a "standard" port is free or is *this* project's service — `lsof -iTCP:<port> -sTCP:LISTEN` and check what's actually listening before debugging auth as the culprit.

## Two copies of React made the mobile app unrunnable — and hid the reason

**What happened**: `apps/mobile` crashed on every launch with `Objects are not valid as a React child (found: object with keys {$$typeof, type, key, props, _owner, _store})`, thrown from inside `expo-router`'s own `ErrorOverlay`. The app's own components never appeared in the component tree.
**Root cause**: on Expo SDK 52, `expo-router` resolved **React 19.2.8** while `react-native` resolved **18.3.1**. A React element made by one copy isn't recognised by the other, so a perfectly valid element gets reported as a plain object — that `$$typeof`-as-a-key error message is the signature of a duplicate React, not of bad JSX. It surfaced inside `ErrorOverlay` because the overlay crashed while trying to *render* the underlying error, hiding it completely.
**Fix**: upgraded Expo SDK 52 → 57 (RN 0.76 cannot run React 19 at all — React 19 support starts at RN 0.79), then pinned `react`/`react-dom` to one version for the whole workspace via `pnpm.overrides` in the root `package.json`, so web, admin and mobile share a single copy.
**Avoid next time**: two things. (1) `Objects are not valid as a React child` **listing `$$typeof` among the keys** means duplicate React — check resolution across the tree before touching any component code. (2) Don't diagnose from one target: this was blamed on a "react-native-web tooling bug" purely because the web preview was the only place it had been run. It reproduced identically on a native simulator the first time anyone tried one.

**Superseded note**: the same version split also produced `@types/react` `tsc` errors in `apps/mobile`, which were previously written off here as a cosmetic `tsc`-only artifact with "no runtime impact". That conclusion was wrong — the type errors and the runtime crash were the same problem, and aligning the versions fixed both. A type error that points at a cross-workspace version conflict is worth taking seriously, not explaining away.

## Missing `@babel/runtime` and an RN/react-native-screens version mismatch

**What happened**: Metro bundling failed (`Unable to resolve @babel/runtime/helpers/interopRequireDefault`), and separately Expo's CLI warned about a `react-native`/`react-native-screens` version mismatch.
**Root cause**: `@babel/runtime` is needed by Expo/RN's Babel transform but wasn't listed as an explicit dependency; the RN/react-native-screens pin drifted from what that Expo SDK version expects.
**Fix**: added `@babel/runtime` to `apps/mobile/package.json`; pinned `react-native`/`react-native-screens` to the versions Expo's own CLI warning named.
**Avoid next time**: trust Expo's own CLI version-mismatch warnings — they name the exact expected version, don't guess.

## Express 5's `req.params` typing

**What happened**: `req.params.id` typed as `string | string[] | undefined` (Express 5 supports repeated route segments), breaking direct usage as a plain string.
**Fix**: a small `requireParam(req, name)` helper in `lib/params.ts` that validates and throws if the param isn't a plain string, used everywhere instead of an unsafe cast.
**Avoid next time**: don't `as string` cast an Express 5 route param — use the helper.

## A literal `@` in a `DATABASE_URL` password

**What happened**: a password containing a literal `@` (`welcome@123`) was set directly in a `postgres://user:password@host/db` connection string.
**What actually happened, checked rather than assumed**: both Node's `URL` parser and the `pg` driver's connection-string parser correctly split on the *last* `@` before the host, so this worked without URL-encoding in practice — but it's fragile and easy to get wrong with a different client library.
**Avoid next time**: URL-encode special characters in a connection-string password (`@` → `%40`) rather than relying on a parser splitting correctly on the last `@` — verified working here, but don't assume every tool agrees.

## A generated file blocked every commit, and it looked like a test failure

**What happened**: commits were failing, reported as "a test is still failing." The full suite was green — 8/8 turbo tasks, every test passing.
**Root cause**: the pre-commit hook runs `lint-staged`, which runs **ESLint before the tests**. It failed on `apps/web/next-env.d.ts` — a file Next.js regenerates on every build and explicitly marks "should not be edited." Its triple-slash reference trips `@typescript-eslint/triple-slash-reference`, so linting it produced an error nobody was allowed to fix. It only started biting once `apps/web` had staged TypeScript files.
**Fix**: added `**/next-env.d.ts` to the ESLint ignores in `eslint.config.mjs`. Separately, `*.config.js` files (babel/postcss) needed a CommonJS + Node-globals block — they were failing `no-undef` on `module`, which is the file's entire contract.
**Avoid next time**: when a commit fails, read *which* stage failed rather than trusting the summary — lint runs before tests, so "commit blocked" and "test failing" are not the same claim. And never lint generated files: if the fix would be overwritten by the next build, the file belongs in `ignores`.

## `next build` while `next dev` is running corrupts the dev server

**What happened**: the web app started returning 500s on every route — `ENOENT ... .next/server/vendor-chunks/tailwind-merge@2.6.1.js`.
**Root cause**: `next build` and `next dev` share the `.next` directory. Running a production build while the dev server was live overwrote the chunks the running server had already resolved, leaving it pointing at files that no longer existed.
**Fix**: stop the dev server, `rm -rf .next`, restart. Nothing in the source was wrong.
**Avoid next time**: don't run `next build` against a workspace with `next dev` live — verify with the dev server, or stop it first. A sudden 500 on *every* route right after a build is this, not a code change.

## A percentage height with no parent to resolve against

**What happened**: the dashboard's revenue-trend bars rendered as nothing — month labels showed, bars didn't.
**Root cause**: each bar had `height: {n}%` but its immediate parent was a flex *column* with no definite height. A percentage height resolves against the parent's height; with none, it collapses to zero. The fixed `h-[100px]` was on the grandparent.
**Fix**: made the bars direct children of the fixed-height row and moved the labels to their own row beneath it.
**Avoid next time**: a `%` height needs a parent with a *definite* height, not merely an ancestor that has one. If a bar/fill silently doesn't render, check what its immediate parent's height actually resolves to before suspecting the data.
