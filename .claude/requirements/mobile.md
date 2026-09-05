# Mobile App (`apps/mobile`, iOS + Android) — Functional & Non-Functional Requirements

Operational subset, not full parity — see "Mobile scope" in `steering/product.md`. Cross-reference: `rules/mobile.md`.

## Functional requirements

### Auth
Login (email/password against the self-built auth API), logout, email verification, password reset, JWT refresh, workspace switching, session-expiry handling.

### Dashboard
Outstanding, paid, overdue, due-soon totals (grouped by currency, same rule as web); recent invoices; recent payments.

### Client management
List, search, view, create, edit basic details. (Delete stays ADMIN-only and web-only, per product scope — confirm in `core-invoicing` design.md whether mobile omits it entirely or shows read-only.)

### Invoice management
List, search/filter, view detail, create a simple invoice (basic line items, no advanced tax/discount editing), edit draft, send, share (native share sheet), download/share PDF, record offline payment. Complex templates/settings stay web-only.

### Payments
Tenant view: payment status, payment history, record offline payment, paid-notification receipt. Client-portal (`USER`) access is **not** part of the mobile app at all — see `product.md`.
Pay-invoice flow (for the tenant's own recorded/offline tracking, not card entry) deep-links to the same hosted payment page used on web — no embedded card entry, avoiding PCI/app-store SDK complexity.

### Push notifications
Invoice paid, invoice overdue, payment failed, reminder-sent events. SSE serves the active foreground web/dashboard experience; push notifications are mobile's equivalent for background/backgrounded use — they are not the same mechanism and both are required, not interchangeable.

### Profile
View/edit basic profile, change password, workspace switch, logout.

### Subscription
Read-only plan/renewal display + "Manage on web" link. No StoreKit/Play Billing integration — explicitly excluded (see `product.md` for the store-policy reasoning).

## Explicit exclusions (stay web-only)
Complex invoice editing, workspace settings, team management, subscription management, branding, integrations, exports, advanced reporting, any Super Admin functionality, client portal (the `USER` role doesn't get a mobile app at all).

## Non-functional requirements

| Category | Requirement |
|---|---|
| Security | Store refresh tokens in Keychain/Keystore (`expo-secure-store`) — never `AsyncStorage`. HTTPS only. No sensitive data in debug logs. Backend remains the sole source of truth for RBAC — the app never locally decides an authorization outcome. Biometric app-lock (Face ID/Touch ID, Android biometric) on top of the session. |
| Performance | Fast startup — cold start < 2s on a mid-range device. ⚠️ confirm target device tier. Paginated lists, efficient caching, small API payloads, lazy image loading. |
| Network resilience | Handle weak network, timeout, lost connectivity, session expiration, and retriable failures without crashing or showing a broken state. |
| Offline behavior | Cache previously viewed data for offline display, clearly marked stale/offline — never show possibly-outdated numbers as if live. Avoid offline financial writes (e.g. queued mark-paid actions) unless explicitly designed later — don't build silent write-queueing as an incidental side effect of caching. |
| Compatibility | Support current, reasonably common versions of Android and iOS. ⚠️ pick explicit minimum versions based on actual target users, not a generic "last 2 versions" default. |
| Store compliance | No in-app card capture, no in-app subscription purchase — both would trigger store payment-fee/review requirements this product deliberately avoids. |
| Business logic | Thin client only — the app must not compute an invoice total or a status transition on-device; that logic lives in the API (`rules/mobile.md`). |
| Push delivery | Via Expo Push → FCM/APNs; every core feature must degrade gracefully without push permission granted. |
| Updates | OTA updates via Expo for most changes, without app-store review, except native-module changes. |
| Testing | Logic in `lib/`/`services/`-equivalent covered by Vitest; component-level testing approach (RN Testing Library) ⚠️ still to be confirmed. |
