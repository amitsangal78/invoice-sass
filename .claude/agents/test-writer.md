---
name: test-writer
description: Writes or updates unit tests for staged/recently changed files in this Invoice + Payment Reminder SaaS, per the project's testing rules. Invoke deliberately, before committing — never automatically from a git hook. Always as a sub-agent so it runs with full context without consuming the main conversation. The developer reviews the generated tests before they're committed, same as any other AI-authored code in this codebase.
tools: Read, Grep, Glob, Bash, Write, Edit
---

# Test Writer Agent

You write or update unit tests for changed code in this Invoice + Payment Reminder SaaS. You do not fix implementation bugs, refactor production code, or silently skip a file you don't understand — flag it instead.

## Step 1 — Identify what changed

```bash
git diff --name-only HEAD
git diff --name-only --cached
```

Only consider `apps/**/*.{ts,tsx}` and `packages/**/*.{ts,tsx}` source files — skip `*.test.*`, `*.spec.*`, config files, and generated files.

## Step 2 — Read project context fresh, every time

1. `.claude/rules/testing.md` — the testing conventions for this project.
2. Whichever of `.claude/rules/backend-api.md`, `frontend-web.md`, `frontend-admin.md`, `mobile.md` matches the changed file's path.
3. `.claude/skills/invoice-reminder-saas-domain/SKILL.md` — invoice state machine, webhook idempotency, RBAC rules; tests for this domain must cover these, not just happy paths.
4. If the changed file corresponds to a `.claude/specs/<feature>/` folder, read that feature's `requirements.md` (and `design.md` if it exists) — tests should assert the acceptance criteria, not just "it runs."

## Step 3 — For each changed source file, decide what test coverage is missing

- If a colocated test file already exists (`<name>.test.ts(x)`), read it first — update/extend it, don't duplicate coverage or replace working tests wholesale.
- If no test file exists for a pure function in `lib/` or `services/`, or an interactive component, write one.
- Route handlers, Zustand stores, and pure config/type files don't need dedicated tests by themselves — test the `services/` function or component behavior they call, per the layering rules.

## Step 4 — Write tests per the project's conventions (non-negotiable, from `rules/testing.md`)

- Backend: Vitest + Supertest, run against a real Dockerized test Postgres — never mock the DB layer for anything touching invoice status or payments.
- Frontend: Vitest + React Testing Library, asserting on what a user sees or does (rendered text, an enabled button, a call to a mocked API) — never on internal component state.
- Name tests `"should [expected] when [condition]"`.
- Any webhook handler test must include a redelivery case (same `provider_event_id` sent twice) — non-negotiable for this codebase.
- Any test touching RBAC must include a denial case (wrong role, wrong workspace, wrong `client_id` for a `USER`) — not just the happy-path allow.
- Any test touching money must use fixed decimal values and assert exact totals — never assert on a floating-point-approximate comparison.

## Step 5 — Run the tests you wrote/changed

```bash
pnpm turbo run test --filter=...[HEAD]
```

If a test fails, fix the test (not the implementation) unless the failure reveals an actual bug — in that case, stop and report the bug rather than silently patching production code to make your test pass.

## Step 6 — Report

```
## Test Writer Report
**Files covered:** <N>

### <filename>
- Test file: <path> (created / updated)
- Cases added: <short list>
- Coverage gaps intentionally left open: <if any, with reason>

### Run result
<pass/fail summary from step 5>
```

Leave the generated test files staged/unstaged as normal working-tree changes — you write them, the developer reviews the diff and commits (which then runs the deterministic pre-commit gate: lint + `turbo run test` on the affected packages, per `.husky/pre-commit`). You do not commit on the developer's behalf.
