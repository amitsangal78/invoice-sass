import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction, withTenant, type Database } from '@invoice/database';
import { unseal } from '@invoice/database/crypto';
import { applyPaymentEvent } from '../../api/src/integrations/paymentEvents';
import { loadConfig } from '../../api/src/config';
import { deliverMail } from './sendMail';
import { renderInvoicePdf,renderCertificatePdf } from '@invoice/documents';
import { createMinimalPdf, storeDocument } from '../../api/src/storage';

const otpMessage = z.object({
  to: z.email(),
  code: z.string().regex(/^\d{6}$/),
  purpose: z.string().optional(),
  expires_at: z.iso.datetime().optional(),
});

export async function deliverOne(db: Database, key: string, directory: string): Promise<boolean> {
  const job = await transaction(db, async client => {
    // Recover expired leases with bounded attempts
    await client.query(`UPDATE outbox_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,
      lease_token=NULL,lease_until=NULL,last_error='LEASE_EXPIRED',encrypted_payload=CASE WHEN attempts>=max_attempts THEN NULL ELSE encrypted_payload END
      WHERE status='RUNNING' AND lease_until<now()`);
    const row = (await client.query(`SELECT * FROM outbox_jobs WHERE status IN ('READY','RETRY') AND available_at<=now() AND attempts<max_attempts
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) return null;
    const lease = randomUUID();
    await client.query("UPDATE outbox_jobs SET status='RUNNING',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '30 seconds' WHERE id=$1", [row.id, lease]);
    return { ...row, lease };
  });

  if (!job) return false;

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });

    if (job.kind === 'OTP') {
      const challenge = (await db.query('SELECT expires_at,consumed_at,invalidated_at FROM otp_challenges WHERE id=$1', [job.payload.challenge_id])).rows[0];
      if (!challenge || challenge.expires_at <= new Date() || challenge.consumed_at || challenge.invalidated_at) {
        await db.query("UPDATE outbox_jobs SET status='CANCELLED',encrypted_payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2", [job.id, job.lease]);
        return true;
      }
      const content = otpMessage.parse(unseal(job.encrypted_payload, key));
      await deliverMail(db,key,directory,job,content);
    } else if (job.kind === 'PDF' && job.payload.kind==='RECEIPT_PDF') {
      if(!job.vendor_id)throw new Error('RECEIPT_VENDOR_REQUIRED');
      await withTenant(db,job.vendor_id,async client=>{
        const receipt=(await client.query(`SELECT r.*,p.method,p.external_payment_id,p.customer_id,c.name,c.email
          FROM receipts r JOIN payments p ON p.id=r.payment_id JOIN customers c ON c.id=p.customer_id WHERE r.id=$1 FOR UPDATE OF r`,[job.payload.receipt_id])).rows[0];
        if(!receipt)throw new Error('RECEIPT_NOT_FOUND');
        if((await client.query("SELECT 1 FROM documents WHERE receipt_id=$1 AND status='READY'",[receipt.id])).rowCount)return;
        const pdf=createMinimalPdf(`Payment Receipt ${receipt.number}`,[['Customer',receipt.name],['Amount INR',String(receipt.amount_snapshot)],['Method',receipt.method],['Provider payment',receipt.external_payment_id??'Manual'],['Receipt date',new Date(receipt.created_at).toISOString()],['Status','Payment confirmed; bank settlement is separate.']]);
        const stored=await storeDocument(job.vendor_id,'receipts',pdf);
        await client.query(`INSERT INTO documents(vendor_id,kind,receipt_id,invoice_id,object_key,mime_type,byte_size,content_hash,status) VALUES($1,'RECEIPT_PDF',$2,$3,$4,$5,$6,$7,'READY')`,[job.vendor_id,receipt.id,job.payload.invoice_id??null,stored.objectKey,stored.mimeType,stored.byteSize,stored.contentHash]);
      });
    } else if(job.kind==='PDF'&&job.payload.kind==='COURSE_CERTIFICATE'){
      if(!job.vendor_id||!job.encrypted_payload)throw new Error('Certificate context is missing.');
      await withTenant(db,job.vendor_id,async client=>{
        if((await client.query('SELECT 1 FROM documents WHERE id=$1',[job.payload.document_id])).rowCount)return;
        const revision=(await client.query('SELECT header_snapshot FROM invoice_revisions WHERE id=$1 AND invoice_id=$2',[job.payload.revision_id,job.payload.invoice_id])).rows[0];
        if(!revision)throw new Error('Invoice revision not found.');
        const header=revision.header_snapshot,details=unseal(job.encrypted_payload,key) as import('@invoice/documents').CertificateDetails;
        const pdf=await renderCertificatePdf(details,header.seller?.business_name??'Course provider',job.payload.certificate_number,header.invoice_number);
        const stored=await storeDocument(job.vendor_id,'certificates',pdf);
        await client.query(`INSERT INTO documents(id,vendor_id,kind,invoice_id,invoice_revision_id,certificate_number,object_key,mime_type,byte_size,content_hash,status)
          VALUES($1,$2,'COURSE_CERTIFICATE',$3,$4,$5,$6,$7,$8,$9,'READY') ON CONFLICT(id) DO NOTHING`,[job.payload.document_id,job.vendor_id,job.payload.invoice_id,job.payload.revision_id,job.payload.certificate_number,stored.objectKey,stored.mimeType,stored.byteSize,stored.contentHash]);
      });
    } else if (job.kind === 'PDF') {
      if(!job.vendor_id||!job.payload.revision_id)throw new Error('PDF job requires vendor and revision context.');
      await withTenant(db,job.vendor_id,async client=>{
        const revision=(await client.query('SELECT * FROM invoice_revisions WHERE id=$1 AND invoice_id=$2 FOR UPDATE',[job.payload.revision_id,job.payload.invoice_id])).rows[0];
        if(!revision)throw new Error('Invoice revision not found.');
        const header={...revision.header_snapshot,current_revision_no:revision.revision_no};
        if(!(await client.query("SELECT 1 FROM documents WHERE invoice_revision_id=$1 AND kind='INVOICE_PDF' AND status='READY'",[revision.id])).rowCount){
          const pdf=await renderInvoicePdf(header,revision.lines_snapshot);
          const stored=await storeDocument(job.vendor_id,'invoices',pdf);
          await client.query(`INSERT INTO documents(vendor_id,kind,invoice_id,invoice_revision_id,object_key,mime_type,byte_size,content_hash,status)
            VALUES($1,'INVOICE_PDF',$2,$3,$4,$5,$6,$7,'READY')`,[job.vendor_id,revision.invoice_id,revision.id,stored.objectKey,stored.mimeType,stored.byteSize,stored.contentHash]);
        }
        const certificates=header.document_options?.certificates??[];
        for(let index=0;index<certificates.length;index++){
          if((await client.query("SELECT 1 FROM documents WHERE invoice_revision_id=$1 AND kind='COURSE_CERTIFICATE' AND certificate_index=$2",[revision.id,index])).rowCount)continue;
          const certificateNumber=`CERT-${header.invoice_number}-R${revision.revision_no}-${index+1}`;
          const pdf=await renderCertificatePdf(certificates[index],header.seller?.business_name??header.seller_snapshot?.business_name??'Course provider',certificateNumber,header.invoice_number);
          const stored=await storeDocument(job.vendor_id,'certificates',pdf);
          await client.query(`INSERT INTO documents(vendor_id,kind,invoice_id,invoice_revision_id,certificate_index,certificate_number,object_key,mime_type,byte_size,content_hash,status)
            VALUES($1,'COURSE_CERTIFICATE',$2,$3,$4,$5,$6,$7,$8,$9,'READY')`,[job.vendor_id,revision.invoice_id,revision.id,index,certificateNumber,stored.objectKey,stored.mimeType,stored.byteSize,stored.contentHash]);
        }
      });
    } else if (job.kind === 'EMAIL') {
      let content: any = {};
      if (job.encrypted_payload) {
        content = unseal(job.encrypted_payload, key);
      } else {
        content = job.payload;
      }
      await deliverMail(db,key,directory,job,content);
    } else if(job.kind==='RECONCILE'){
      const event=(await db.query("SELECT * FROM provider_events WHERE id=$1 AND provider='RAZORPAY'",[job.payload.provider_event_id])).rows[0];
      if(!event)throw new Error('PROVIDER_EVENT_NOT_FOUND');
      const result=await applyPaymentEvent(db,loadConfig(),unseal(event.payload_ciphertext,key),event.external_event_id);
      if('status' in result&&result.status==='UNMATCHED')throw new Error('PROVIDER_EVENT_UNMATCHED');
    } else if (job.kind === 'RECURRING') {
      // Process recurring schedules
      const schedules = (await db.query("SELECT * FROM recurring_schedules WHERE active=true AND next_due_at<=now()")).rows;
      for (const s of schedules) {
        const nextDue = new Date(s.next_due_at);
        if (s.frequency === 'WEEKLY') nextDue.setDate(nextDue.getDate() + 7 * s.interval_count);
        else nextDue.setMonth(nextDue.getMonth() + s.interval_count);

        await db.query('UPDATE recurring_schedules SET next_due_at=$2,version=version+1 WHERE id=$1', [s.id, nextDue]);
        await db.query(
          `INSERT INTO recurring_occurrences(id,vendor_id,schedule_id,scheduled_for,status)
           VALUES($1,$2,$3,$4,'CREATED')
           ON CONFLICT DO NOTHING`,
          [randomUUID(), s.vendor_id, s.id, s.next_due_at]
        );
      }
    } else if (job.kind === 'REMINDER') {
      // Reminder checks
      const overdue = (await db.query(
        `SELECT i.*, c.email as customer_email
         FROM invoices i
         JOIN customers c ON i.customer_id=c.id
         WHERE i.document_state='ISSUED' AND i.reminders_paused=false AND i.due_date < CURRENT_DATE`
      )).rows;
      for (const inv of overdue) {
        await writeFile(
          resolve(directory, `reminder-${inv.id}-${new Date().toISOString().slice(0, 10)}.json`),
          JSON.stringify({ kind: 'REMINDER_NOTICE', invoice_id: inv.id, to: inv.customer_email, amount: inv.total }, null, 2),
          { mode: 0o600 }
        );
      }
    }

    await db.query("UPDATE outbox_jobs SET status='SUCCEEDED',completed_at=now(),encrypted_payload=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2", [job.id, job.lease]);
  } catch (err: any) {
    await db.query(
      `UPDATE outbox_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,
       available_at=now()+(least(300,power(2,attempts))::integer*interval '1 second'),last_error=$3,
       encrypted_payload=CASE WHEN attempts>=max_attempts THEN NULL ELSE encrypted_payload END,lease_token=NULL,lease_until=NULL
       WHERE id=$1 AND lease_token=$2`,
      [job.id, job.lease, String(err?.message ?? 'PROCESSING_FAILED')]
    );
  }
  return true;
}
