---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---

# Frontend (tenant web app) rules

- Use the App Router; keep authenticated dashboard routes under `app/(dashboard)/`, public marketing routes under `app/(marketing)/`.
- Style with Tailwind utilities first; drop to a CSS Module only when a layout genuinely can't be expressed in utilities.
- Use shadcn/ui components from `packages/ui` — don't hand-roll a component that already exists there.
- Theme through CSS variable tokens only; never hardcode a color or write a second dark-mode variant of a component.
- Server state goes through TanStack Query; client-only UI state through Zustand — don't duplicate server state into a store.
- Every form validates against the same zod schema the API uses, imported from `packages/types` — don't redefine validation on the frontend.
