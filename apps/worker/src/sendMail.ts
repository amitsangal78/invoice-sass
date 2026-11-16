import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {renderEmail,sendEmail,isEmailProvider,type EmailProvider} from '@invoice/email';
import {seal,secretHmac} from '@invoice/database/crypto';
import {transaction,type Database} from '@invoice/database';

export async function deliverMail(db:Database,key:string,directory:string,job:any,content:any){
  if(job.provider_message_id)return; // Provider acceptance already persisted on a prior lease.
  let provider=job.delivery_provider as EmailProvider|undefined;
  if(!provider){
    const setting=(await db.query("SELECT value FROM integration_settings WHERE key='email_delivery'")).rows[0];
    const selected=setting?.value.provider??process.env.DELIVERY_MODE??'local';
    if(!isEmailProvider(selected))throw new Error('EMAIL_PROVIDER_INVALID');
    provider=selected;
    await db.query('UPDATE outbox_jobs SET delivery_provider=$2 WHERE id=$1 AND lease_token=$3',[job.id,provider,job.lease]);
  }
  if(process.env.NODE_ENV==='production'&&(provider==='local'||provider==='ses-local'))throw new Error('LOCAL_EMAIL_DISABLED_IN_PRODUCTION');
  const message=renderEmail(content);
  const hash=secretHmac(key,message.to.trim().toLowerCase());
  if((await db.query('SELECT 1 FROM email_suppressions WHERE recipient_hash=$1 AND cleared_at IS NULL',[hash])).rowCount)throw new Error('EMAIL_RECIPIENT_SUPPRESSED');
  const log=(await db.query(`INSERT INTO email_messages(job_id,vendor_id,attempt_no,template,recipient_ciphertext,recipient_hash)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[job.id,job.vendor_id,Number(job.attempts)+1,content.kind??content.purpose??'NOTIFICATION',seal({to:message.to},key),hash])).rows[0];
  try{
    if(provider==='local'){
      await mkdir(directory,{recursive:true,mode:0o700});
      await writeFile(resolve(directory,`${job.id}.json`),JSON.stringify({...content,kind:job.kind==='OTP'?'OTP_EMAIL':'EMAIL_NOTIFICATION',subject:message.subject,text:message.text,html:message.html},null,2),{mode:0o600});
    }
    const messageId=await sendEmail(provider,message,job.id);
    await transaction(db,async client=>{
      await client.query("UPDATE email_messages SET status='ACCEPTED',provider_message_id=$2,accepted_at=now() WHERE id=$1",[log.id,messageId]);
      await client.query('UPDATE outbox_jobs SET provider_message_id=$2 WHERE id=$1 AND lease_token=$3',[job.id,messageId,job.lease]);
    });
  }catch(error){
    await db.query("UPDATE email_messages SET status='UNCERTAIN' WHERE id=$1",[log.id]);
    // Keep provider errors free from recipients, credentials and OTP payloads.
    throw new Error(error instanceof Error&&/^(SES_|RESEND_|EMAIL_)/.test(error.message)?error.message:'EMAIL_SEND_UNCONFIRMED');
  }
}
