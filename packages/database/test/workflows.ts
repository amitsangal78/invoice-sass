import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';
import type { Database } from '../src/index';
import { hashPassword, unseal } from '../src/crypto';
import { createApp } from '../../../apps/api/src/app';
import { deliverOne } from '../../../apps/worker/src/deliver';
import type { Config } from '../../../apps/api/src/config';

export async function workflowChecks(admin:Database,db:Database,config:Config,directory:string){
  const app=createApp(db,config),password='workflow-test-password-2026';let checks=0;
  const pass=(name:string)=>{checks++;console.log(`PASS ${name}`);};
  async function api(method:'get'|'post'|'patch',path:string,body?:object,cookie?:string,status=200){
    let q=request(app)[method](`/api/v1${path}`).set('Origin',config.WEB_ORIGIN);
    if(cookie)q=q.set('Cookie',cookie);
    if(path==='/auth/signup')q=q.set('Idempotency-Key',randomUUID());
    const r=await(body===undefined?q:q.send(body));
    assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(r.body)}`);return r;
  }
  function cookieOf(r:any):string { const value=r.headers['set-cookie']?.[0]; assert.equal(typeof value,'string'); return value; }
  async function code(challengeId:string){
    const row=(await admin.query("SELECT encrypted_payload FROM outbox_jobs WHERE payload->>'challenge_id'=$1",[challengeId])).rows[0];
    return (unseal(row.encrypted_payload,config.DELIVERY_KEY) as {code:string}).code;
  }
  const owner=await api('post','/auth/signup',{email:'workflow-owner@example.test',password},undefined,201);
  const cookie=cookieOf(owner),vendorId=owner.body.data.vendor_id;
  const initial=(await admin.query('SELECT id FROM otp_challenges WHERE user_id=$1',[owner.body.data.user_id])).rows[0].id;
  await api('post','/auth/email-verifications/verify',{challenge_id:initial,code:await code(initial)},cookie);
  const address={line1:'1 Test Road',city:'Delhi',state_code:'DL',postal_code:'110001',country_code:'IN'};
  const profile=await api('patch','/vendor/onboarding',{version:1,business_name:'Workflow Seller',contact_email:'workflow-owner@example.test',address},cookie);
  let submitted=await api('post','/vendor/onboarding/submit',{version:profile.body.data.version},cookie);
  const adminUser=randomUUID();
  await admin.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,'workflow-admin@example.test',$2,now())",[adminUser,await hashPassword(password)]);
  await admin.query("INSERT INTO platform_owners(user_id) VALUES($1)",[adminUser]);
  const login=await api('post','/auth/login',{email:'workflow-admin@example.test',password,client_type:'WEB'});
  const adminCookie=cookieOf(login);
  const draftAccount=await api('post','/auth/signup',{email:'review-draft@example.test',password},undefined,201);
  const vendors=(await api('get','/admin/vendors',undefined,adminCookie)).body.data;
  const listed=vendors.find((v:any)=>v.id===vendorId),draftListed=vendors.find((v:any)=>v.id===draftAccount.body.data.vendor_id);
  assert.equal(listed.owner_email,'workflow-owner@example.test');assert.equal(listed.contact_email,'workflow-owner@example.test');assert.equal(listed.onboarding_request_id,submitted.body.data.id);
  assert.equal(draftListed.owner_email,'review-draft@example.test');assert.equal(draftListed.status,'DRAFT');assert.equal(draftListed.contact_email,null);assert.equal(draftListed.onboarding_request_id,null);
  const pending=(await api('get','/admin/change-requests?status=SUBMITTED',undefined,adminCookie)).body.data.find((r:any)=>r.id===submitted.body.data.id);
  assert.equal(pending.owner_email,'workflow-owner@example.test');assert.equal(pending.business_name,'Workflow Seller');
  const detail=(await api('get','/admin/vendors/'+vendorId,undefined,adminCookie)).body.data;
  assert.equal(detail.owner.email,'workflow-owner@example.test');assert.equal(detail.change_requests[0].proposed_profile.business_name,'Workflow Seller');assert.equal(JSON.stringify(detail).includes('password_hash'),false);
  await api('post',`/admin/change-requests/${submitted.body.data.id}/review`,{version:1,decision:'MORE_INFO'},adminCookie,422);
  await api('post',`/admin/change-requests/${submitted.body.data.id}/review`,{version:1,decision:'MORE_INFO',reason:'Please provide the business address.'},adminCookie);
  let currentVendor=(await api('get','/vendor',undefined,cookie)).body.data;
  assert.equal(currentVendor.status,'MORE_INFO');assert.equal(currentVendor.onboarding_review.reason,'Please provide the business address.');
  submitted=await api('post','/vendor/onboarding/submit',{version:currentVendor.version},cookie);
  await api('post',`/admin/change-requests/${submitted.body.data.id}/review`,{version:1,decision:'REJECT',reason:'Business details need correction.'},adminCookie);
  currentVendor=(await api('get','/vendor',undefined,cookie)).body.data;
  assert.equal(currentVendor.status,'REJECTED');assert.equal(currentVendor.onboarding_review.reason,'Business details need correction.');
  submitted=await api('post','/vendor/onboarding/submit',{version:currentVendor.version},cookie);
  pass('Admin sees draft registration identity and submitted application details; more-info/reject reasons return to the vendor');
  const reviewed=await api('post',`/admin/change-requests/${submitted.body.data.id}/review`,{version:1,decision:'APPROVE'},adminCookie);
  assert.equal(reviewed.body.data.status,'APPROVED');
  assert.equal((await api('get','/vendor',undefined,cookie)).body.data.status,'APPROVED');
  assert.ok((await api('get','/admin/dashboard',undefined,adminCookie)).body.data.vendor_stats.length);
  await api('get','/admin/vendors',undefined,cookie,403);
  assert.equal((await db.query('SELECT count(*) FROM vendors')).rows[0].count,'0');
  pass('Platform Owner lists and approves onboarding; admin context does not leak to pooled queries');

  const change=await api('post','/vendor/change-requests',{kind:'SENSITIVE_PROFILE',proposed_changes:{contact_email:'verified-new@example.test'}},cookie,201);
  const changePath=`/vendor/change-requests/${change.body.data.id}/email-verifications`;
  await api('post',`${changePath}/verify`,{challenge_id:randomUUID(),code:'000000'},cookie,401);
  await api('post',`/admin/change-requests/${change.body.data.id}/review`,{version:1,decision:'APPROVE'},adminCookie,400);
  const challenge=(await api('post',changePath,{},cookie,202)).body.data.challenge_id;
  const correct=await code(challenge),wrong=correct==='000000'?'111111':'000000';
  await api('post',`${changePath}/verify`,{challenge_id:challenge,code:wrong},cookie,401);
  assert.equal((await admin.query('SELECT attempts FROM otp_challenges WHERE id=$1',[challenge])).rows[0].attempts,1);
  const verified=await api('post',`${changePath}/verify`,{challenge_id:challenge,code:correct},cookie);
  await api('post',`${changePath}/verify`,{challenge_id:challenge,code:correct},cookie,401);
  await api('post',`/admin/change-requests/${change.body.data.id}/review`,{version:verified.body.data.version,decision:'APPROVE'},adminCookie);
  pass('Sensitive email change requires a matching single-use OTP; failed attempts persist');

  const creator=await api('post','/vendor/creators',{email:'workflow-creator@example.test',password,status:'ACTIVE'},cookie,201);
  assert.equal((await api('get','/vendor/creators',undefined,cookie)).body.data.length,1);
  const creatorLogin=await api('post','/auth/login',{email:'workflow-creator@example.test',password,client_type:'WEB'});
  const creatorCookie=cookieOf(creatorLogin);
  await api('post','/vendor/creators',{email:'denied@example.test',password,status:'ACTIVE'},creatorCookie,403);
  await api('post','/auth/password/change',{current_password:password,new_password:password+'new'},creatorCookie,403);
  await api('post',`/vendor/creators/${creator.body.data.id}/freeze`,{version:1},cookie);
  await api('get','/auth/me',undefined,creatorCookie,401);
  await api('post',`/vendor/creators/${creator.body.data.id}/unfreeze`,{version:2},cookie);
  await api('post',`/vendor/creators/${creator.body.data.id}/reset-password`,{new_password:password+'new'},cookie,204);
  await api('post','/auth/login',{email:'workflow-creator@example.test',password,client_type:'WEB'},undefined,401);
  await api('post','/auth/login',{email:'workflow-creator@example.test',password:password+'new',client_type:'WEB'});
  pass('Owner can create/list/freeze/unfreeze/reset Creators; Creator role restrictions hold');

  const customer=await api('post','/customers',{name:'Workflow Customer',email:'workflow-customer@example.test',address},cookie,201);
  const item=await api('post','/catalogue-items',{name:'Workflow Service',item_type:'SERVICE',unit:'hour',unit_price:100},cookie,201);
  const invoice=await api('post','/invoices',{customer_id:customer.body.data.id,lines:[{catalogue_item_id:item.body.data.id,quantity:2}]},cookie,201);
  const invoiceId=invoice.body.data.id;
  await api('post',`/invoices/${invoiceId}/submit`,{version:1},cookie,403);
  await api('post',`/invoices/${invoiceId}/approve-and-issue`,{version:1},cookie);
  const mail=(await admin.query("SELECT encrypted_payload FROM outbox_jobs WHERE kind='EMAIL' AND payload->>'invoice_id'=$1",[invoiceId])).rows[0];
  const token=(unseal(mail.encrypted_payload,config.DELIVERY_KEY) as {link_token:string}).link_token;
  assert.equal((await api('post','/public/invoice-links/inspect',{link_token:token})).body.data.status,'VALID');
  assert.equal((await api('post','/public/invoice-links/inspect',{link_token:'wrong'})).body.data.status,'UNAVAILABLE');
  const otp=(await api('post','/public/invoice-links/otp',{link_token:token},undefined,202)).body.data.challenge_id;
  const customerCode=await code(otp);
  await api('post','/public/invoice-links/verify',{link_token:token,challenge_id:otp,code:customerCode==='000000'?'111111':'000000'},undefined,401);
  assert.equal((await admin.query('SELECT attempts FROM otp_challenges WHERE id=$1',[otp])).rows[0].attempts,1);
  const cv=await api('post','/public/invoice-links/verify',{link_token:token,challenge_id:otp,code:customerCode});
  const customerCookie=cookieOf(cv);
  await api('post','/public/invoice-links/verify',{link_token:token,challenge_id:otp,code:customerCode},undefined,401);
  assert.equal((await api('get','/customer/invoice',undefined,customerCookie)).body.data.outstanding_amount,200);
  pass('Issued link and customer OTP establish a scoped 15-minute session with replay protection');

  for(let i=0;i<30;i++)if(!await deliverOne(db,config.DELIVERY_KEY,directory))break;
  const doc=(await admin.query("SELECT * FROM documents WHERE invoice_id=$1 AND kind='INVOICE_PDF'",[invoiceId])).rows[0];
  assert.ok(doc,'PDF worker generated a document');
  assert.equal((await admin.query("SELECT status FROM outbox_jobs WHERE kind='PDF' AND payload->>'invoice_id'=$1",[invoiceId])).rows[0].status,'SUCCEEDED');
  const pdf=await api('get',`/invoices/${invoiceId}/document/content`,undefined,cookie);
  assert.match(pdf.headers['content-type'] ?? '',/application\/pdf/);
  assert.ok(pdf.body.includes(Buffer.from('Workflow Customer')));
  assert.ok(pdf.body.includes(Buffer.from('Workflow Service')));
  await api('get',`/documents/${doc.id}/content`,undefined,undefined,401);
  await api('get',`/documents/${randomUUID()}/content`,undefined,cookie,404);
  await api('get','/customer/invoice/document/content',undefined,customerCookie);
  pass('Worker persists actual invoice PDF; authorized download has real lines/customer, anonymous and missing documents denied');

  const other=await api('post','/auth/signup',{email:'workflow-other@example.test',password},undefined,201);
  const otherCookie=cookieOf(other);
  await api('get',`/invoices/${invoiceId}`,undefined,otherCookie,404);
  await api('get',`/documents/${doc.id}/content`,undefined,otherCookie,404);
  assert.equal((await db.query('SELECT count(*) FROM invoice_access_links')).rows[0].count,'0');
  pass('Invoice, PDF, and capability context remain isolated across tenants');

  const firstAttempt=(await api('post','/customer/payment-attempts',{amount:100,method:'CHECKOUT_UPI'},customerCookie,202)).body.data;
  const webhookSecret='workflow-webhook-secret-for-testing';
  const signedApp=createApp(db,{...config,RAZORPAY_WEBHOOK_SECRET:webhookSecret});
  const raw=JSON.stringify({event_id:'workflow-signed-event',event:'payment.captured',payload:{payment:{entity:{id:'pay_workflow_signed',order_id:firstAttempt.external_order_id,amount:10000,currency:'INR',status:'captured'}}}},null,2);
  const signature=createHmac('sha256',webhookSecret).update(raw).digest('hex');
  assert.equal((await request(signedApp).post('/api/v1/webhooks/razorpay').set('Content-Type','application/json').set('X-Razorpay-Signature','0'.repeat(64)).send(raw)).status,401);
  for(let i=0;i<2;i++)assert.equal((await request(signedApp).post('/api/v1/webhooks/razorpay').set('Content-Type','application/json').set('X-Razorpay-Signature',signature).send(raw)).status,200);
  assert.equal((await api('get','/customer/invoice',undefined,customerCookie)).body.data.outstanding_amount,100);
  pass('Webhook verifies original raw bytes and signature; replayed captured event allocates once');

  const attempt=(await api('post','/customer/payment-attempts',{amount:100,method:'CHECKOUT_UPI'},customerCookie,202)).body.data;
  await api('post',`/customer/payment-attempts/${attempt.attempt_id}/simulate`,{},customerCookie);
  await api('post',`/customer/payment-attempts/${attempt.attempt_id}/simulate`,{},customerCookie);
  assert.equal((await api('get','/customer/invoice',undefined,customerCookie)).body.data.outstanding_amount,0);
  assert.equal((await api('get','/payments',undefined,cookie)).body.data.length,2);
  assert.equal((await api('get','/receipts',undefined,cookie)).body.data.length,2);
  await api('post','/customer/payment-attempts',{amount:200,method:'CHECKOUT_UPI'},customerCookie,400);
  await api('post','/webhooks/razorpay',{},undefined,503);
  pass('Authenticated simulated payment allocates once, creates receipt, reaches paid state; unsigned unconfigured webhook denied');

  const current=(await api('get',`/invoices/${invoiceId}`,undefined,cookie)).body.data;
  await api('post',`/invoices/${invoiceId}/revisions`,{version:current.version,reason:'Update invoice quantity',draft:{customer_id:customer.body.data.id,lines:[{catalogue_item_id:item.body.data.id,quantity:3}]}},cookie,201);
  for(let i=0;i<20;i++)if(!await deliverOne(db,config.DELIVERY_KEY,directory))break;
  const revised=await api('get','/customer/invoice/document/content',undefined,customerCookie);
  assert.ok(revised.body.includes(Buffer.from('Total INR: 300')));
  assert.ok(revised.body.includes(Buffer.from('Workflow Customer')));
  assert.equal((await admin.query('SELECT count(*) FROM invoice_revisions WHERE invoice_id=$1',[invoiceId])).rows[0].count,'2');
  pass('Invoice revision queues and serves an updated PDF while retaining immutable prior revision');

  await api('post','/customer/logout',{},customerCookie,204);
  await api('get','/customer/invoice',undefined,customerCookie,401);
  assert.equal((await db.query('SELECT count(*) FROM customer_sessions')).rows[0].count,'0');
  pass('Customer logout revokes session and clears transaction-local capability context');
  // Provider HTTP calls are mocked here; no real Razorpay credentials/network are used.
  const again=(await api('post','/public/invoice-links/otp',{link_token:token},undefined,202)).body.data.challenge_id;
  const againSession=await api('post','/public/invoice-links/verify',{link_token:token,challenge_id:again,code:await code(again)});
  const realCookie=cookieOf(againSession),keySecret='mock-provider-key-secret';
  const connected=createApp(db,{...config,PAYMENT_DRIVER:'razorpay',RAZORPAY_KEY_ID:'rzp_test_QA123',RAZORPAY_KEY_SECRET:keySecret});
  const originalFetch=globalThis.fetch;
  let orderCalls=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url==='https://api.razorpay.com/v1/orders'&&init?.method==='POST'){
      orderCalls++;const order=JSON.parse(String(init.body));assert.equal(order.amount,10000);assert.equal(order.currency,'INR');
      return new Response(JSON.stringify({...order,id:'order_provider_qa',status:'created'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(url==='https://api.razorpay.com/v1/payments/pay_provider_qa')return new Response(JSON.stringify({id:'pay_provider_qa',order_id:'order_provider_qa',amount:10000,currency:'INR',status:'captured',method:'upi'}),{status:200,headers:{'Content-Type':'application/json'}});
    throw Error('Unexpected provider HTTP call in focused check');
  };
  try{
    const create=()=>request(connected).post('/api/v1/customer/payment-attempts').set('Origin',config.WEB_ORIGIN).set('Cookie',realCookie).send({amount:100,method:'CHECKOUT_UPI'});
    const attempt=await create();assert.equal(attempt.status,202,JSON.stringify(attempt.body));
    const resume=await create();assert.equal(resume.status,202);assert.equal(orderCalls,1);assert.equal(attempt.body.data.attempt_id,resume.body.data.attempt_id);
    const path=`/api/v1/customer/payment-attempts/${attempt.body.data.attempt_id}/checkout-result`;
    const body={provider_order_id:'order_provider_qa',provider_payment_id:'pay_provider_qa',provider_signature:'0'.repeat(64)};
    assert.equal((await request(connected).post(path).set('Origin',config.WEB_ORIGIN).set('Cookie',realCookie).send(body)).status,401);
    body.provider_signature=createHmac('sha256',keySecret).update('order_provider_qa|pay_provider_qa').digest('hex');
    const confirmed=await request(connected).post(path).set('Origin',config.WEB_ORIGIN).set('Cookie',realCookie).send(body);
    assert.equal(confirmed.status,202,JSON.stringify(confirmed.body));assert.equal(confirmed.body.data.status,'SUCCEEDED');
    assert.equal((await api('get','/invoices/'+invoiceId,undefined,cookie)).body.data.outstanding_amount,0);
    assert.equal((await api('get','/admin/integrations',undefined,adminCookie)).body.data.email_options.length,4);
    await api('patch','/admin/integrations/email',{provider:'local'},adminCookie);
    await api('patch','/admin/integrations/email',{provider:'local'},cookie,403);
    pass('Razorpay order/resume/callback signature and server lookup work; email selector is admin-only (provider HTTP mocked)');
  }finally{globalThis.fetch=originalFetch;}

  return checks;
}
