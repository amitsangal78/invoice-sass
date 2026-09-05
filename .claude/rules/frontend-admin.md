---
paths:
  - "apps/admin/**"
---

# Internal admin console rules

- This app is cross-tenant. Every query must be explicit about which workspace(s) it targets — never assume the single-workspace scoping the tenant web app relies on.
- Every route requires an authenticated internal-staff session plus an explicit RBAC role check. "It's internal, so it's fine" is not a valid reason to skip the check.
- Reuse `packages/ui` for visual consistency with the tenant app, but keep this app's routes and auth session separate — never share a session with the tenant app.
