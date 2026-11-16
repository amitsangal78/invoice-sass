import { randomUUID,createHash } from 'node:crypto';
import { transaction,type Database,type PoolClient } from '@invoice/database';
import { seal } from '@invoice/database/crypto';
import type { Config } from '../config';
import { HttpError } from '../errors';

async function notify(client:PoolClient,config:Config,attempt:any,kind:string,entity:any,details:Record<string,unknown>){
  const customer=(await client.query('SELECT email FROM customers WHERE id=$1',[attempt.customer_id])).rows[0];
  const owner=(await client.query("SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.role='OWNER' AND m.status<>'REMOVED'",[attempt.vendor_id])).rows[0];
  const invoice=attempt.invoice_id?(await client.query('SELECT invoice_number,customer_snapshot FROM invoices WHERE id=$1',[attempt.invoice_id])).rows[0]:null;
  for(const [role,to] of [['customer',invoice?.customer_snapshot?.email??customer?.email],['owner',owner?.email]]){
    if(!to)continue;
    const key=`payment-mail:${kind}:${entity.id}:${role}`;
    await client.query(`INSERT INTO outbox_jobs(kind,vendor_id,business_key,payload,encrypted_payload) VALUES('EMAIL',$1,$2,$3,$4) ON CONFLICT(business_key) DO NOTHING`,
      [attempt.vendor_id,key,JSON.stringify({kind,invoice_id:attempt.invoice_id,payment_id:details.payment_id}),seal({to,kind,recipient_role:role,invoice_number:invoice?.invoice_number,amount:Number(entity.amount)/100,...details},config.DELIVERY_KEY)]);
  }
}
export async function applyPaymentEvent(db:Database,config:Config,payload:any,eventId:string,scope?:{vendorId:string;invoiceId:string|null;attemptId:string}){
  const entity=payload.payload?.payment?.entity;
  const eventType=payload.event;
  if(!['payment.captured','payment.authorized','payment.failed','order.paid'].includes(eventType))return {received:true,ignored:true};
  if(!entity?.id||!entity.order_id)throw new HttpError(422,'INVALID_PAYMENT_EVENT','Payment event has no payment or order reference.');
  const dedupe=`razorpay:${config.RAZORPAY_KEY_ID??'simulation'}:${eventId}`;
  const event=(await db.query(`INSERT INTO provider_events(provider,external_event_id,dedupe_key,event_type,payload_ciphertext)
    VALUES('RAZORPAY',$1,$2,$3,$4) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id,status`,[eventId,dedupe,eventType,seal(payload,config.DELIVERY_KEY)])).rows[0];
  if(event.status==='PROCESSED')return {received:true,deduplicated:true,status:['payment.captured','order.paid'].includes(eventType)?'SUCCEEDED':'PENDING'};
  try{return await transaction(db,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[dedupe]);
    if((await client.query('SELECT status FROM provider_events WHERE id=$1',[event.id])).rows[0].status==='PROCESSED')return {received:true,deduplicated:true};
    await client.query("SELECT set_config('app.provider_order_id',$1,true)",[entity.order_id]);
    const notes=entity.notes?.attempt_id?entity.notes:payload.payload?.order?.entity?.notes;
    if(/^[a-f0-9-]{36}$/i.test(notes?.attempt_id??''))await client.query("SELECT set_config('app.provider_attempt_id',$1,true)",[notes.attempt_id]);
    const routing=(await client.query('SELECT * FROM payment_attempts WHERE external_order_id=$1 OR id::text=$2',[entity.order_id,notes?.attempt_id??''])).rows[0];
    if(!routing){await client.query("UPDATE provider_events SET status='UNMATCHED',error_code='ATTEMPT_NOT_FOUND' WHERE id=$1",[event.id]);await client.query("INSERT INTO outbox_jobs(kind,business_key,payload) VALUES('RECONCILE',$1,$2) ON CONFLICT(business_key) DO NOTHING",[`provider-replay:${event.id}`,JSON.stringify({provider_event_id:event.id})]);return {received:true,status:'UNMATCHED'};}
    if(scope&&(routing.id!==scope.attemptId||routing.vendor_id!==scope.vendorId||routing.invoice_id!==scope.invoiceId))throw new HttpError(404,'ATTEMPT_NOT_FOUND','Payment attempt not found.');
    await client.query("SELECT set_config('app.vendor_id',$1,true)",[routing.vendor_id]);
    // Invoice before attempt is the common lock order for creation and confirmation.
    const invoice=routing.invoice_id?(await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[routing.invoice_id])).rows[0]:null;
    const attempt=(await client.query('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE',[routing.id])).rows[0];
    const account=(await client.query('SELECT external_account_id FROM provider_accounts WHERE id=$1',[attempt.provider_account_id])).rows[0];
    if(attempt.driver==='razorpay'&&account.external_account_id!==config.RAZORPAY_KEY_ID)throw new HttpError(422,'PAYMENT_ACCOUNT_MISMATCH','Payment account mismatch.');
    if(attempt.external_order_id&&attempt.external_order_id!==entity.order_id)throw new HttpError(422,'ORDER_MISMATCH','Payment order mismatch.');
    if(!attempt.external_order_id)await client.query('UPDATE payment_attempts SET external_order_id=$2 WHERE id=$1',[attempt.id,entity.order_id]);
    const completed=async()=>client.query("UPDATE provider_events SET status='PROCESSED',processed_at=now(),error_code=NULL WHERE id=$1",[event.id]);
    if(eventType==='payment.failed'){
      if(attempt.status==='SUCCEEDED'){await completed();return {received:true,status:'SUCCEEDED'};}
      // A failed payment does not make an order unusable: Razorpay can retry that order.
      if(attempt.status!=='SUCCEEDED')await client.query("UPDATE payment_attempts SET status='PENDING',last_error_code='PAYMENT_FAILED',version=version+1 WHERE id=$1",[attempt.id]);
      await notify(client,config,attempt,'PAYMENT_FAILED',entity,{reason:'The payment was not completed. No successful payment has been confirmed for this attempt.'});
      await completed();return {received:true,status:attempt.status==='SUCCEEDED'?'SUCCEEDED':'PENDING'};
    }
    if(eventType==='payment.authorized'){
      if(attempt.status!=='SUCCEEDED')await client.query("UPDATE payment_attempts SET status='PENDING',last_error_code='AWAITING_CAPTURE' WHERE id=$1",[attempt.id]);
      await completed();return {received:true,status:attempt.status==='SUCCEEDED'?'SUCCEEDED':'PENDING'};
    }
    if(entity.status!=='captured'||entity.currency!=='INR'||!Number.isSafeInteger(entity.amount)||entity.amount<=0)throw new HttpError(422,'INVALID_PAYMENT_EVENT','Invalid captured payment.');
    const existing=(await client.query('SELECT id FROM payments WHERE provider_account_id=$1 AND external_payment_id=$2',[attempt.provider_account_id,entity.id])).rows[0];
    if(existing){await completed();return {received:true,status:'SUCCEEDED',deduplicated:true};}
    const amount=entity.amount/100,paymentId=randomUUID();
    await client.query(`INSERT INTO payments(id,vendor_id,customer_id,attempt_id,provider_account_id,external_payment_id,source,method,amount,currency,received_at,verified_event_id)
      VALUES($1,$2,$3,$4,$5,$6,'PROVIDER_TEST',$7,$8,'INR',now(),$9)`,[paymentId,attempt.vendor_id,attempt.customer_id,attempt.id,attempt.provider_account_id,entity.id,entity.method==='upi'?'UPI':entity.method==='netbanking'?'BANK':'OTHER',amount,event.id]);
    let allocated=0;
    if(invoice&&invoice.document_state==='ISSUED'){
      const balance=(await client.query(`SELECT coalesce((SELECT sum(amount) FROM payment_allocations a WHERE a.invoice_id=$1 AND NOT EXISTS(SELECT 1 FROM allocation_reversals r WHERE r.allocation_id=a.id)),0) AS allocated,
        coalesce((SELECT sum(amount) FROM credit_notes WHERE invoice_id=$1 AND status='ISSUED' AND invoice_revision_id IS NULL),0) AS credits`,[invoice.id])).rows[0];
      allocated=Math.min(amount,Math.max(0,Number(invoice.total)-Number(balance.allocated)-Number(balance.credits)));
      if(allocated>0)await client.query('INSERT INTO payment_allocations(vendor_id,customer_id,payment_id,invoice_id,amount) VALUES($1,$2,$3,$4,$5)',[attempt.vendor_id,attempt.customer_id,paymentId,invoice.id,allocated]);
    }
    if((invoice&&amount>allocated)||entity.amount!==Math.round(Number(attempt.requested_amount)*100)||attempt.status==='SUCCEEDED'){
      await client.query(`INSERT INTO reconciliation_cases(vendor_id,payment_id,attempt_id,kind,details) VALUES($1,$2,$3,'EXCESS',$4)`,[attempt.vendor_id,paymentId,attempt.id,JSON.stringify({received:amount,allocated,expected:Number(attempt.requested_amount),reason:invoice?.document_state==='CANCELLED'?'LATE_CAPTURE_AFTER_CANCELLATION':'CAPTURE_REQUIRES_REVIEW'})]);
    }
    const year=new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata',year:'numeric'});
    const sequence=(await client.query(`INSERT INTO document_sequences(vendor_id,kind,series,next_value) VALUES($1,'RECEIPT',$2,2)
      ON CONFLICT(vendor_id,kind,series) DO UPDATE SET next_value=document_sequences.next_value+1 RETURNING next_value-1 AS value`,[attempt.vendor_id,year])).rows[0];
    const receiptId=randomUUID(),number=`REC-${year}-${String(sequence.value).padStart(4,'0')}`;
    await client.query('INSERT INTO receipts(id,vendor_id,payment_id,number,amount_snapshot,allocation_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[receiptId,attempt.vendor_id,paymentId,number,amount,JSON.stringify(invoice&&allocated>0?[{invoice_id:invoice.id,amount:allocated}]:[])]);
    await client.query("UPDATE payment_attempts SET status='SUCCEEDED',external_payment_id=$2,last_error_code=NULL,version=version+1 WHERE id=$1",[attempt.id,entity.id]);
    await client.query(`INSERT INTO outbox_jobs(kind,vendor_id,business_key,payload) VALUES('PDF',$1,$2,$3) ON CONFLICT(business_key) DO NOTHING`,[attempt.vendor_id,`receipt-pdf:${receiptId}`,JSON.stringify({kind:'RECEIPT_PDF',receipt_id:receiptId,invoice_id:attempt.invoice_id})]);
    await notify(client,config,attempt,'PAYMENT_SUCCESS',entity,{payment_id:paymentId,receipt_id:receiptId,receipt_number:number,allocated_amount:allocated});
    await completed();return {received:true,status:'SUCCEEDED',receipt_id:receiptId};
  });}catch(error){await db.query("UPDATE provider_events SET status='FAILED',error_code=$2 WHERE id=$1",[event.id,error instanceof HttpError?error.code:'PROCESSING_FAILED']);throw error;}
}
export function eventFingerprint(raw:string){return createHash('sha256').update(raw).digest('hex');}
