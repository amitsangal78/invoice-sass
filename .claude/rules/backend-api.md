---
paths:
  - "apps/api/**"
  - "packages/db/**"
---

# Backend API rules

- Validate every request body and query string with a zod schema from `packages/types`.
- Response shape is always `{ data: T }` on success or `{ error: { code, message } }` on failure — no route invents its own shape. The one deliberate exception: a binary file response (e.g. `GET /invoices/:id/pdf`) can't be wrapped in JSON — send it directly with the correct `Content-Type`, errors still go through the normal error middleware.
- Every query touching `clients`, `invoices`, or `invoice_items` filters by `workspace_id`, resolved server-side from the caller's `workspace_members` row — never trust a client-supplied workspace id. No exceptions — a `SUPER_ADMIN`/`SUPPORT_ADMIN` cross-tenant query is a separate, explicitly-named function in `apps/api/src/services/admin/`, never a route that "forgot" the filter.
- Every route also checks the caller's role has permission for the action (see the RBAC table in `invoice-reminder-saas-domain`), and — for client-portal (`USER`) requests — that the resource belongs to the caller's own `client_id`, not just their workspace.
- Webhook handlers: verify signature → check `webhook_events` for `provider_event_id` → then mutate state. Never skip the dedupe check, even to "fix it quickly."
- New migrations live in `packages/db/migrations`, one logical change per migration, and are additive — don't edit a migration that's already merged.
- Log every request with a request id, and route every error through the shared error middleware — no `console.log` in a route handler.

## Routes are thin — business logic lives in `services/`

A route handler in `apps/api/src/routes/` does exactly three things: parse/validate the request, call one function in `apps/api/src/services/`, shape the response. If a route file contains a conditional on `invoice.status`, a loop over line items, a date calculation, or a call to `packages/db` directly, that logic is misplaced — move it to `services/invoicing/`.

```ts
// ✅ correct — route is a thin adapter
router.post('/invoices/:id/mark-paid', async (req, res) => {
  const result = await markInvoicePaid(req.params.id, req.user.id);
  res.json({ data: result });
});

// ❌ wrong — status logic and DB access inline in the route
router.post('/invoices/:id/mark-paid', async (req, res) => {
  const invoice = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
  if (invoice.status === 'draft') return res.status(400).json({ error: { code: 'invalid_state', message: '...' } });
  await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, req.params.id));
  res.json({ data: invoice });
});
```

Why this matters beyond tidiness: `services/invoicing/` functions are what the webhook handler, the manual "mark as paid" route, and (later) a background job all call — if the logic lives inline in one route, the other two callers either duplicate it or bypass it.

- `services/<domain>/` — business logic, status transitions, invoice numbering, plan-limit checks. Pure enough to unit test without spinning up Express.
- `lib/db/` — Drizzle client and query builders only, no business rules.
- `lib/webhooks/` — signature verification and idempotency helpers, shared by every provider's handler.
