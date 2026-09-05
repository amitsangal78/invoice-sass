# Frontend — Internal Admin Console (`apps/admin`) — Functional & Non-Functional Requirements

For `SUPER_ADMIN` / `SUPPORT_ADMIN` only — your own team, never a tenant. Cross-reference: `rules/frontend-admin.md`, `identity-and-rbac` spec.

## Functional requirements

| Area | Requirement |
|---|---|
| Auth | Separate login/session from the tenant app — never shared, never a tenant credential path. Authorization by `users.platform_role` only, not `workspace_members`. |
| Platform dashboard | Total tenants, total SaaS revenue, total invoices generated, payment-provider status, application error rate — `SUPER_ADMIN` only. |
| Tenant management | Search/list all workspaces; view status/plan/usage; suspend/reactivate (`SUPER_ADMIN` only); `SUPPORT_ADMIN` gets read-only view of the same. |
| Support tooling | View a tenant's invoice/payment *metadata* (counts, statuses) without opening the financial records themselves by default; view failed webhook/payment events; resend a verification email; unlock a locked account. |
| Plan management | View/manage plan definitions and limits; override a specific tenant's plan (`SUPER_ADMIN` only, audited). |
| Webhook tooling | Inspect `webhook_events`; manually replay a failed webhook (audited, `SUPER_ADMIN` only). |
| Config | Feature flags, email templates, platform-wide configuration — `SUPER_ADMIN` only. |
| Audit visibility | Every admin view or action against tenant data is itself logged and visible here — the admin console is subject to the same audit trail it lets support staff read. |

## Non-functional requirements

| Category | Requirement |
|---|---|
| Access control | Every route requires an authenticated internal-staff session *and* an explicit role check — "it's internal, so it's fine" is not a valid reason to skip it (`rules/frontend-admin.md`). MFA recommended for internal accounts given the financial-data exposure. ⚠️ confirm as a hard requirement or a strong recommendation. |
| Network exposure | ⚠️ decide: public internet with strong auth, or IP-allowlisted/VPN-only. Not yet decided — flag before first deploy. |
| Auditability | Every tenant-data view/action writes an audit row (see backend requirements) — this console is not exempt from the audit trail it displays. |
| Performance | Usable, not premium — no aggressive LCP/TTI targets like the tenant app; correctness and access control matter more than speed here. |
| Cross-tenant safety | Every query explicit about which workspace(s) it targets — never assume the single-workspace scoping the tenant app relies on (`rules/frontend-admin.md`). |
| Testing | Vitest + React Testing Library, same as the tenant app; role-check bypass is a ❌-tier bug class here, test it explicitly. |

## Explicit exclusions
No tenant-facing functionality of any kind. No shared components that leak tenant session assumptions — reuse `packages/ui` for visuals only.
