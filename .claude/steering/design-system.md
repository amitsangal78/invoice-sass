# Design System — Billify

Brand: **Billify** — "Invoice. Get Paid. Grow." Visual keywords: clean, calm, reliable, fast, professional, approachable. The interface should always feel **easy before powerful** — lighter than traditional accounting software, credible enough for freelancers, consultants, and small agencies.

Primary reference: theme2's board (the "B" monogram mark) — matches the tagline exactly and has the more complete token/icon set. Theme1's abstract mark is a considered alternative, not adopted here; confirm if that should stay live as an option.

## Logo usage

- **Full logo + wordmark** — web header (logged-out), login/signup screens, marketing pages.
- **Logo mark only** — favicon, mobile app icon, sidebar-collapsed state.
- **Three icon variants** (from theme2's "App Icons" board): light background (blue mark on white/light surface), primary (white mark on solid `#2563EB`), dark (blue mark on `#0F172A`) — pick per platform's icon requirements (iOS/Android adaptive icons typically need the primary or dark variant, not the light one, for contrast in app-drawer contexts).
- **White-on-blue variant** — dark or branded surfaces (hero sections, the dark-background login variant shown on theme1's board).
- Product icons: simple line icons, consistent visual weight across web and mobile — see the icon set on both boards (Home, Invoices, Clients, Payments, Reports, Team, Settings, Workspaces, Notifications, Search, Add, Edit, View/Delete, Send, Download/Share).

## Color tokens

**Never hardcode a hex value in a component** — reference the semantic token. This is already a hard rule in `rules/frontend-web.md`; this file is where the token *values* live so that rule has something concrete to point at.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `background` | `#F8FAFC` | `#0F172A` | Dark background reuses light mode's `textPrimary` value — deliberate, keeps the palette coherent (see below) and matches the dark app-icon background on theme2's board. |
| `surface` | `#FFFFFF` | `#1E293B` | Cards, modals, the topbar. |
| `border` | `#E2E8F0` | `#334155` | |
| `textPrimary` | `#0F172A` | `#F1F5F9` | |
| `textSecondary` | `#475569` | `#94A3B8` | |
| `textMuted` | `#94A3B8` | `#64748B` | From theme2's board; use for placeholder text, disabled labels, timestamps. |
| `primary` | `#2563EB` | `#3B82F6` | Dark-mode primary is brightened one step for AA contrast against a dark background — the light-mode value reads as too muted on `#0F172A`. |
| `primaryLight` | `#DBEAFE` | `#1E3A5F` | Subtle tinted backgrounds (selected sidebar item, active tab, info banners). |
| `success` | `#16A34A` | `#22C55E` | |
| `warning` | `#D97706` | `#F59E0B` | |
| `danger` | `#DC2626` | `#EF4444` | |

Dark-mode values are a first design pass, not yet used anywhere in the product (dark mode stays a later build priority per the brand brief) — but the tokens exist now so no component ever hardcodes a color that would need hunting down later. Implement as CSS variables (web) and a matching RN theme object (mobile) — see `tech.md`'s theming row.

### Invoice status colors (consistent everywhere — web, mobile, portal, PDF)

| Status | Color | Token |
|---|---|---|
| Draft | Gray/slate | `status.draft` → `textSecondary`/`border` family |
| Sent | Blue | `status.sent` → `primary` family |
| Partially Paid | Amber | `status.partiallyPaid` → `warning` family |
| Paid | Green | `status.paid` → `success` family |
| Overdue | Red | `status.overdue` → `danger` family |
| Cancelled | Slate (darker/neutral) | `status.cancelled` → `textSecondary` family, visually distinct from Draft (Cancelled reads more "closed," Draft more "in progress" — don't let them collapse to the same gray) |

**Always pair color with a text label or icon — never color alone** (this is also an accessibility requirement already in `requirements/frontend-web.md`'s WCAG line; colorblind users can't rely on hue alone to distinguish Sent-blue from Overdue-red-adjacent states).

## Typography

Font: **Inter**, both platforms.

| Role | Size | Weight |
|---|---|---|
| Display (marketing hero) | 40–48px | 700 |
| H1 (page title) | 28px | 700 |
| H2 (section header) | 20px | 600 |
| H3 (card title) | 16px | 600 |
| Body | 14px | 400 |
| Small (secondary text, table meta) | 13px | 400 |
| Caption (timestamps, helper text) | 12px | 400 |

## Spacing, radius, elevation

- **Spacing**: 8px base unit — 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius**: inputs/buttons `8px`, cards `12px`, modals `16px`, badges fully rounded (pill).
- **Elevation (light)**: very subtle shadows only (`0 1px 2px rgba(15,23,42,0.06)` for cards, slightly more for modals/popovers) — thin `1px` borders do most of the separation work, not shadow weight.
- **Elevation (dark)**: shadows read poorly on dark backgrounds — use a one-step-lighter `surface` fill plus the `border` token for separation instead of relying on shadow; don't just reuse the light-mode shadow values.

## Shared component primitives

Same visual language, platform-appropriate implementation:

| Primitive | Web (`packages/ui`, shadcn/ui base) | Mobile (`apps/mobile`, custom RN) |
|---|---|---|
| Button, Input, Select, DatePicker | shadcn/ui, themed via the tokens above | Custom RN primitives, same tokens, no shared runtime code (RN can't render web components) but the same token file drives both |
| Card, Badge, Avatar | shadcn/ui | Custom RN |
| Modal | shadcn/ui `Dialog` | RN `Modal` |
| BottomSheet | N/A (web doesn't need it) | RN-specific — no web equivalent required |
| Toast, Skeleton | shadcn/ui | Custom RN |

Storybook (`packages/ui`) is the source of truth for the web set; document the RN set's visual parity there too even though the implementation is separate, so a designer/reviewer can compare both in one place.

## Web layout (dashboard-first SaaS)

```
Top Bar: Search · Workspace Switcher · Notifications · Profile
Left Sidebar: Dashboard · Invoices · Clients · Payments · Reports · Team · Settings
Main content: white cards over a soft gray (`background`) page, thin borders, subtle shadows,
generous whitespace, one strong primary CTA per screen
```

Dashboard: greeting header, a 2×2 (or 4-across) stat-card row (Outstanding / Paid This Month / Overdue / Due Soon — currency-grouped per the domain skill, never summed across currencies), then Recent Invoices / Revenue Trend / Recent Payments below. Tables stay compact — status badges and inline actions (icon buttons), not heavy row chrome.

## Mobile layout (action-first)

Bottom navigation: **Home · Invoices · Clients · Payments · More**. Cards instead of tables everywhere (an invoice list row is a card: invoice number, client name, amount, due date, status badge). Invoice creation is a **step flow**, not one long form: **Client → Details → Items → Review → Send**. Emphasize quick visibility, quick actions, payments, reminders, recent activity, notifications — this is the "operational subset" surface from `product.md`, so the UI should feel faster and shallower than web, not a cramped port of the dashboard.

## Client portal (simplest surface)

Deliberately not a dashboard. Logo → outstanding balance → invoice list (card: number, due date, amount) → **View Invoice** / **Pay Now**. The whole point is `invoice → amount → due date → pay`, nothing else competing for attention — no sidebar, no nav chrome, no stat grid.

## Dark mode status

Tokens exist (table above); the UI itself is not being built dark-mode-first. Every component must consume tokens, never hardcoded colors, specifically so flipping the theme later is a token-swap, not a component rewrite.
