import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

async function reviewFixture(page:Page){
  const draft={id:'11111111-1111-4111-8111-111111111111',status:'DRAFT',version:1,business_name:null,contact_email:null,owner_email:'registered-draft@example.test',owner_email_verified_at:null,created_at:'2026-11-16T09:00:00Z',onboarding_request_id:null};
  const vendor={id:'22222222-2222-4222-8222-222222222222',status:'SUBMITTED',version:3,business_name:'Submitted QA Business',contact_email:'billing@example.test',owner_email:'registered-owner@example.test',owner_email_verified_at:'2026-11-16T09:01:00Z',created_at:'2026-11-16T09:00:00Z',onboarding_request_id:'33333333-3333-4333-8333-333333333333'};
  const profile={business_name:vendor.business_name,contact_email:vendor.contact_email,contact_mobile:'9999999999',gstin:'QA-GSTIN',address:{line1:'12 Review Street',city:'Delhi',state_code:'DL',postal_code:'110001'}};
  const request:any={id:vendor.onboarding_request_id,vendor_id:vendor.id,kind:'ONBOARDING',target:'ONBOARDING',status:'SUBMITTED',version:1,created_at:vendor.created_at,vendor_status:vendor.status,owner_email:vendor.owner_email,business_name:vendor.business_name,contact_email:vendor.contact_email,proposed_profile:profile};
  const decisions:any[]=[];
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method();let data:any;
    if(path==='/api/v1/auth/me')data={user_id:'44444444-4444-4444-8444-444444444444',email:'review-admin@example.test',role:'PLATFORM_OWNER',membership_id:null,vendor_id:null,vendor_status:null,restricted:false,required_actions:[]};
    else if(path==='/api/v1/admin/vendors')data=[draft,vendor];
    else if(path==='/api/v1/admin/dashboard')data={pending_changes:request.status==='SUBMITTED'?1:0,failed_jobs:0};
    else if(path==='/api/v1/admin/change-requests')data=request.status==='SUBMITTED'?[request]:[];
    else if(path==='/api/v1/admin/jobs')data=[];
    else if(path==='/api/v1/admin/integrations')data={email_provider:'local',email_options:[],payment:{driver:'razorpay',configured:false,webhook_configured:false}};
    else if(path===`/api/v1/admin/vendors/${draft.id}`)data={vendor:draft,owner:{email:draft.owner_email,email_verified_at:null},profile:null,change_requests:[]};
    else if(path===`/api/v1/admin/vendors/${vendor.id}`)data={vendor,owner:{email:vendor.owner_email,email_verified_at:vendor.owner_email_verified_at},profile,change_requests:[request]};
    else if(method==='POST'&&path===`/api/v1/admin/change-requests/${request.id}/review`){
      const body=route.request().postDataJSON();decisions.push(body);
      request.status=body.decision==='APPROVE'?'APPROVED':body.decision==='REJECT'?'REJECTED':'MORE_INFO';vendor.status=request.status;data=request;
    }else throw Error(`Unexpected request: ${method} ${path}`);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data,meta:{request_id:'fixture'}})});
  });
  return {decisions,draft,vendor};
}

test('vendor list identifies draft registrations and exposes review actions only for submitted applications',async({page})=>{
  const fixture=await reviewFixture(page);await page.goto('/');await page.getByRole('button',{name:/^Vendors \(/}).click();
  const draft=page.getByRole('row').filter({hasText:fixture.draft.owner_email});
  await expect(draft.getByText('Awaiting vendor submission')).toBeVisible();await expect(draft.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
  await draft.getByRole('button',{name:'View details'}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText(fixture.draft.owner_email);await expect(dialog.getByLabel('Review decision')).toHaveCount(0);await page.getByRole('button',{name:'Close vendor details'}).click();
  const submitted=page.getByRole('row').filter({hasText:fixture.vendor.owner_email});
  await expect(submitted).toContainText('billing@example.test');
  await expect(submitted.getByRole('button',{name:'Approve',exact:true})).toBeVisible();await expect(submitted.getByRole('button',{name:'Reject',exact:true})).toBeVisible();
  await submitted.getByRole('button',{name:'Request more information'}).click();
  await expect(dialog).toContainText('registered-owner@example.test');await expect(dialog).toContainText('12 Review Street');
  await expect(dialog.getByRole('button',{name:'Send information request'})).toBeDisabled();await dialog.getByLabel('Reason / information needed').fill('Please provide your complete address.');
  await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/vendor-review-details.png',fullPage:true});
  await dialog.getByRole('button',{name:'Send information request'}).click();
  await expect(page.getByText('More information requested.',{exact:true})).toBeVisible();expect(fixture.decisions).toEqual([{version:1,decision:'MORE_INFO',reason:'Please provide your complete address.'}]);
});

for(const decision of ['APPROVE','REJECT'] as const){
  test(`pending reviews display applicant email and support ${decision.toLowerCase()}`,async({page})=>{
    const fixture=await reviewFixture(page);await page.goto('/');await page.getByRole('button',{name:/^Pending Reviews \(/}).click();
    const row=page.getByRole('row').filter({hasText:fixture.vendor.owner_email});await expect(row).toContainText('Submitted QA Business');
    await row.getByRole('button',{name:decision==='APPROVE'?'Approve':'Reject',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText('billing@example.test');
    if(decision==='REJECT')await dialog.getByLabel('Reason / information needed').fill('Business details are incomplete.');
    await dialog.getByRole('button',{name:decision==='APPROVE'?'Approve request':'Reject request',exact:true}).click();
    await expect(page.getByText(decision==='APPROVE'?'Request approved.':'Request rejected.',{exact:true})).toBeVisible();expect(fixture.decisions[0].decision).toBe(decision);
  });
}
