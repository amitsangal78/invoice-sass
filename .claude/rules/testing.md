---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
---

# Testing rules

- Backend tests hit a real Dockerized test Postgres — don't mock the DB layer for anything touching invoice status or payments.
- Frontend tests assert on what a user sees or does (rendered text, an enabled button, a call to a mocked API), never on internal component state.
- Name tests "should [expected] when [condition]".
- A test for a webhook handler must include a redelivery case (same `provider_event_id` sent twice) — this is the one bug class this codebase can't afford to reintroduce.
