import { describe,it,expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import type { Database } from '@invoice/database';
const config:Config={NODE_ENV:'test',PORT:4000,WEB_ORIGIN:'http://localhost:3000',DATABASE_URL:'unused',OTP_SECRET:'x'.repeat(32),DELIVERY_KEY:'ab'.repeat(32)};
const db={query:async()=>{throw new Error('database unavailable');}} as unknown as Database;
const app=createApp(db,config);
describe('HTTP boundaries',()=>{
  it('requires authentication for every document download route',async()=>{
    const id='11111111-1111-4111-8111-111111111111';
    for(const path of [`/documents/${id}/content`,`/invoices/${id}/document/content`,`/customer/documents/${id}/content`,'/customer/invoice/document/content'])expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
  });
  it('rejects an unconfigured webhook before touching payment records',async()=>{
    expect((await request(app).post('/api/v1/webhooks/razorpay').send({event:'payment.captured'})).status).toBe(503);
  });
  it('exposes liveness without leaking infrastructure',async()=>{
    const r=await request(app).get('/api/v1/health/live');expect(r.status).toBe(200);expect(r.body.data).toEqual({status:'ok',service:'invoice-api',mode:'TEST'});expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('rejects untrusted origins and web login without Origin',async()=>{
    expect((await request(app).post('/api/v1/auth/login').set('Origin','https://evil.example').send({})).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/login').send({email:'owner@example.com',password:'x',client_type:'WEB'})).status).toBe(403);
  });
  it('keeps readiness internal and returns unavailable when database/migration checks fail',async()=>{
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(404);
    const r=await request(app).get('/internal/health/ready');expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('database unavailable');
  });
  it('rejects conflicting cookie and bearer credentials before database access',async()=>{
    const r=await request(app).get('/api/v1/auth/me').set('Cookie',`invoice_staff=${'a'.repeat(43)}`).set('Authorization',`Bearer ${'b'.repeat(43)}`);expect(r.status).toBe(401);
  });
  it('rejects malformed JSON, unknown signup fields and missing idempotency keys',async()=>{
    expect((await request(app).post('/api/v1/auth/login').type('json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/signup').set('Origin',config.WEB_ORIGIN).send({email:'owner@example.com',password:'long-test-password',vendor_id:'injected'})).status).toBe(422);
    expect((await request(app).post('/api/v1/auth/signup').set('Origin',config.WEB_ORIGIN).send({email:'owner@example.com',password:'long-test-password'})).status).toBe(422);
  });
  it('has no Creator password-change, refund or credit endpoint',async()=>{
    for(const path of ['/auth/initial-password','/refunds','/customer-credits'])expect((await request(app).post(`/api/v1${path}`).send({})).status).toBe(404);
  });
});
