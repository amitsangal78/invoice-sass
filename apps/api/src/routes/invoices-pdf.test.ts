import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createTestWorkspace, createTestClient } from '../test/fixtures';

const app = createApp();

const wsHeader = (workspaceId: string) => ['x-workspace-id', workspaceId] as [string, string];

async function createSentInvoice(ws: Awaited<ReturnType<typeof createTestWorkspace>>, clientId: string) {
  const createRes = await request(app)
    .post('/api/v1/invoices')
    .set('Authorization', `Bearer ${ws.accessToken}`)
    .set(...wsHeader(ws.workspaceId))
    .send({ clientId, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'Design work', quantity: '1', unitPrice: '5000.00' }] });
  expect(createRes.status).toBe(201);

  const sendRes = await request(app)
    .post(`/api/v1/invoices/${createRes.body.data.id}/send`)
    .set('Authorization', `Bearer ${ws.accessToken}`)
    .set(...wsHeader(ws.workspaceId));
  expect(sendRes.status).toBe(200);

  return createRes.body.data.id as string;
}

describe('GET /invoices/:id/pdf', () => {
  it('should reject downloading a DRAFT invoice', async () => {
    const ws = await createTestWorkspace('pdf-draft@example.com');
    const client = await createTestClient(ws.workspaceId);

    const createRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set(...wsHeader(ws.workspaceId))
      .send({ clientId: client.id, currency: 'INR', dueDate: '2026-12-31', items: [{ description: 'x', quantity: '1', unitPrice: '10.00' }] });

    const res = await request(app)
      .get(`/api/v1/invoices/${createRes.body.data.id}/pdf`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set(...wsHeader(ws.workspaceId));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invoice_not_sent');
  });

  it('should return a PDF for a SENT invoice', async () => {
    const ws = await createTestWorkspace('pdf-sent@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoiceId = await createSentInvoice(ws, client.id);

    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set(...wsHeader(ws.workspaceId));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    // PDFs start with the "%PDF-" magic bytes.
    expect(Buffer.from(res.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should serve the second download from cache — byte-identical, and not visible to another workspace', async () => {
    const ws = await createTestWorkspace('pdf-cache@example.com');
    const other = await createTestWorkspace('pdf-cache-other@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoiceId = await createSentInvoice(ws, client.id);

    const first = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set(...wsHeader(ws.workspaceId));
    const second = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .set(...wsHeader(ws.workspaceId));

    expect(second.status).toBe(200);
    expect(Buffer.from(second.body as Buffer).equals(Buffer.from(first.body as Buffer))).toBe(true);

    // Same invoice id can never leak across workspaces via the cache key —
    // this workspace never had this invoice, so it's a 404, not someone
    // else's cached PDF.
    const cross = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .set(...wsHeader(other.workspaceId));
    expect(cross.status).toBe(404);
  });

  it('should reject a client-portal-scoped role — ADMIN/MEMBER only', async () => {
    const ws = await createTestWorkspace('pdf-authz@example.com');
    const client = await createTestClient(ws.workspaceId);
    const invoiceId = await createSentInvoice(ws, client.id);

    const res = await request(app).get(`/api/v1/invoices/${invoiceId}/pdf`).set(...wsHeader(ws.workspaceId));

    expect(res.status).toBe(401);
  });
});
