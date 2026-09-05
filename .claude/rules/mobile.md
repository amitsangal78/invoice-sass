---
paths:
  - "apps/mobile/**"
---

# Mobile app rules (React Native / Expo)

- Business logic stays in the API — this app is a thin client. If you're about to compute an invoice total or a status transition on-device, stop and check whether the API should be doing it instead.
- Reuse `packages/types` for every request/response shape — don't redefine a parallel type here.
- Auth tokens go through `expo-secure-store`, never `AsyncStorage`.
- Any screen showing invoice or client data needs a visibly-marked stale/offline state for cached data — never show possibly-outdated numbers as if they're live.
