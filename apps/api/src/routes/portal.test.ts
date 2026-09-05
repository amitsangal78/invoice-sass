import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createTestWorkspace, createTestInvoice } from '../test/fixtures';
import { createClient } from '../services/clients/clients';
import { verifyMagicLink } from '../services/portal-auth/portal-auth';
import { db, magicLinkTokens } from '@invoice-saas/db';
import { generateSecureToken } from '../lib/auth/tokens';

const app = createApp();

async function loginAsPortalClient(email: string): Promise<string> {
  const token = generateSecureToken();
  await db.insert(magicLinkTokens).values({ email, tokenHash: token.hash, expiresAt: new Date(Date.now() + 60_000) });
  const { sessionToken } = await verifyMagicLink(token.raw);
  return sessionToken;
}

describe('portal isolation — cross-client access is rejected on every request', () => {
  it("should reject client A's session accessing client B's invoice, even under the same workspace", async () => {
    const ws = await createTestWorkspace('portalws1@example.com');
    await createClient(ws.workspaceId, { name: 'Client A', email: 'clientA@example.com' });
    const clientB = await createClient(ws.workspaceId, { name: 'Client B', email: 'clientB@example.com' });
    const invoiceB = await createTestInvoice(ws.workspaceId, clientB!.id, { status: 'SENT' });

    const sessionA = await loginAsPortalClient('clientA@example.com');

    const res = await request(app)
      .get(`/api/v1/portal/${clientB!.id}/invoices/${invoiceB.id}`)
      .set('Authorization', `Bearer ${sessionA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_your_business');
  });

  it("should allow a client to see their own invoice", async () => {
    const ws = await createTestWorkspace('portalws2@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Own Client', email: 'ownclient@example.com' });
    const invoice = await createTestInvoice(ws.workspaceId, client!.id, { status: 'SENT' });

    const session = await loginAsPortalClient('ownclient@example.com');

    const res = await request(app)
      .get(`/api/v1/portal/${client!.id}/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${session}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(invoice.id);
  });

  it('should reject a request with no portal session', async () => {
    const ws = await createTestWorkspace('portalws3@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Client', email: 'noauth-client@example.com' });

    const res = await request(app).get(`/api/v1/portal/${client!.id}/invoices`);
    expect(res.status).toBe(401);
  });

  it("should reject a tenant (workspace) access token used as a portal session", async () => {
    // A tenant JWT and a portal opaque session token are structurally
    // different — a tenant access token must not work as portal auth.
    const ws = await createTestWorkspace('portalws4@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Client', email: 'crosstoken@example.com' });

    const res = await request(app)
      .get(`/api/v1/portal/${client!.id}/invoices`)
      .set('Authorization', `Bearer ${ws.accessToken}`);

    expect(res.status).toBe(401);
  });
});

describe('receipt generation via the portal', () => {
  it('should include a stable receiptUrl on a paid invoice, unchanged across repeated fetches', async () => {
    const ws = await createTestWorkspace('receiptportal@example.com');
    const client = await createClient(ws.workspaceId, { name: 'Payer', email: 'receiptpayer@example.com' });
    const invoice = await createTestInvoice(ws.workspaceId, client!.id, { status: 'SENT', total: '250.00' });

    // Record the payment via the tenant-side API (as an ADMIN would).
    await request(app)
      .post(`/api/v1/invoices/${invoice.id}/mark-paid`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set('x-workspace-id', ws.workspaceId)
      .send({ amount: '250.00' });

    const session = await loginAsPortalClient('receiptpayer@example.com');

    const first = await request(app).get(`/api/v1/portal/${client!.id}/payments`).set('Authorization', `Bearer ${session}`);
    const second = await request(app).get(`/api/v1/portal/${client!.id}/payments`).set('Authorization', `Bearer ${session}`);

    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].receiptUrl).toBeTruthy();
    expect(first.body.data[0].receiptUrl).toBe(second.body.data[0].receiptUrl); // not regenerated per request
  });
});
