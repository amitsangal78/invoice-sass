import { randomUUID } from 'node:crypto';
import { withTenant,type Database } from '@invoice/database';
import type { Config } from '../config';
import { HttpError } from '../errors';
import { amountInPaise,razorpayClient } from './razorpay';

export function checkoutData(attempt:any,config:Config){
  const simulation=attempt.driver==='simulation';
  return {attempt_id:attempt.id,status:attempt.status,driver:attempt.driver,requested_amount:Number(attempt.requested_amount),currency:attempt.currency,
    method:attempt.method,external_order_id:attempt.external_order_id,external_qr_id:attempt.external_qr_id,
    expires_at:attempt.expires_at,last_error_code:attempt.last_error_code,
    checkout:!simulation&&attempt.external_order_id?{key:config.RAZORPAY_KEY_ID,order_id:attempt.external_order_id,amount:amountInPaise(Number(attempt.requested_amount)),currency:'INR',name:'Invoice payment',description:'Invoice SaaS · Razorpay Test Mode'}:null};
}
export async function createProviderAttempt(db:Database,config:Config,vendorId:string,invoiceId:string|null,customerId:string|undefined,amount:number,method:string,requestKey?:string){
  const paise=amountInPaise(amount),driver=config.PAYMENT_DRIVER??'razorpay';
  const provider=driver==='razorpay'?razorpayClient(config):null;
  if(driver==='simulation'&&config.NODE_ENV==='production')throw new HttpError(403,'SIMULATION_DISABLED','Local simulation is disabled.');
  if(provider&&method==='PROVIDER_QR')throw new HttpError(422,'QR_UNAVAILABLE_IN_TEST_MODE','Razorpay UPI QR/Intent requires Live Mode. Use Razorpay Test Checkout or explicitly enabled local simulation.');
  const reserved=await withTenant(db,vendorId,async client=>{
    // Serialize creation per invoice (or customer for advances); do not hold DB locks across HTTP calls.
    let targetCustomer=customerId;
    if(invoiceId){
      const inv=(await client.query(`SELECT i.*,coalesce((SELECT sum(amount) FROM payment_allocations a WHERE a.invoice_id=i.id AND NOT EXISTS(SELECT 1 FROM allocation_reversals r WHERE r.allocation_id=a.id)),0) AS allocated,
        coalesce((SELECT sum(amount) FROM credit_notes c WHERE c.invoice_id=i.id AND c.status='ISSUED' AND c.invoice_revision_id IS NULL),0) AS credits
        FROM invoices i WHERE i.id=$1 FOR UPDATE`,[invoiceId])).rows[0];
      if(!inv||inv.document_state!=='ISSUED')throw new HttpError(400,'INVOICE_NOT_PAYABLE','Invoice is not payable.');
      targetCustomer=inv.customer_id;
      const outstanding=Math.max(0,Number(inv.total)-Number(inv.allocated)-Number(inv.credits));
      if(amount>outstanding||outstanding<=0)throw new HttpError(400,outstanding<=0?'ALREADY_PAID':'INVALID_AMOUNT','Amount exceeds the invoice outstanding balance.');
    }else{
      if(!(await client.query("SELECT id FROM customers WHERE id=$1 AND status='ACTIVE' FOR UPDATE",[customerId])).rowCount)throw new HttpError(404,'CUSTOMER_NOT_FOUND','Customer not found.');
    }
    const requestId=requestKey??randomUUID();
    const prior=(await client.query('SELECT * FROM payment_attempts WHERE vendor_id=$1 AND idempotency_key=$2',[vendorId,requestId])).rows[0];
    if(prior){if(prior.invoice_id!==invoiceId||prior.customer_id!==targetCustomer||Number(prior.requested_amount)!==amount||prior.method!==method)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','Use a new request key for a different payment.');return {attempt:prior,created:false};}
    const active=(await client.query("SELECT * FROM payment_attempts WHERE customer_id=$1 AND invoice_id IS NOT DISTINCT FROM $2 AND status IN ('CREATING','PENDING','UNKNOWN') ORDER BY created_at DESC LIMIT 1",[targetCustomer,invoiceId])).rows[0];
    if(active){
      if(Number(active.requested_amount)===amount&&active.method===method&&active.driver===driver)return {attempt:active,created:false};
      throw new HttpError(409,'COMPETING_ATTEMPT','A previous payment is unresolved. Check or resume it first.',{attempt_id:active.id});
    }
    const keyId=provider?.keyId??'local_simulation';
    const account=(await client.query(`INSERT INTO provider_accounts(provider,mode,external_account_id,secret_reference) VALUES('RAZORPAY','TEST',$1,'env:RAZORPAY_KEY_SECRET')
      ON CONFLICT(provider,mode,external_account_id) DO UPDATE SET enabled=true RETURNING id`,[keyId])).rows[0];
    const id=randomUUID(),receipt=`inv_${id.replaceAll('-','')}`;
    const attempt=(await client.query(`INSERT INTO payment_attempts(id,vendor_id,customer_id,invoice_id,provider_account_id,purpose,requested_amount,currency,method,status,idempotency_key,provider_receipt,driver,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'INR',$8,'CREATING',$9,$10,$11,now()+interval '15 minutes') RETURNING *`,
      [id,vendorId,targetCustomer,invoiceId,account.id,invoiceId?'INVOICE':'ADVANCE',amount,method,requestId,receipt,driver])).rows[0];
    return {attempt,created:true};
  });
  let attempt=reserved.attempt;
  if(!reserved.created)return checkoutData(attempt,config);
  try{
    const order=provider?await provider.createOrder(paise,attempt.provider_receipt,{attempt_id:attempt.id,vendor_id:vendorId,invoice_id:invoiceId??''}):{id:`order_sim_${attempt.id}`,amount:paise,currency:'INR',receipt:attempt.provider_receipt};
    if(order.amount!==paise||order.currency!=='INR')throw new HttpError(503,'PROVIDER_RESULT_UNKNOWN','Provider returned an unexpected order.');
    attempt=await withTenant(db,vendorId,async client=>(await client.query(`UPDATE payment_attempts SET external_order_id=$2,status=CASE WHEN status='CREATING' THEN 'PENDING' ELSE status END,version=version+1 WHERE id=$1 RETURNING *`,[attempt.id,order.id])).rows[0]);
    return checkoutData(attempt,config);
  }catch(error){
    const code=error instanceof HttpError?error.code:'PROVIDER_RESULT_UNKNOWN';
    await withTenant(db,vendorId,client=>client.query("UPDATE payment_attempts SET status=CASE WHEN status='CREATING' THEN $2 ELSE status END,last_error_code=$3 WHERE id=$1",[attempt.id,code==='PROVIDER_REQUEST_REJECTED'?'FAILED':'UNKNOWN',code]));
    throw new HttpError(503,code,'Payment order could not be confirmed. Check the existing attempt before starting another payment.',{attempt_id:attempt.id});
  }
}
