import { SESv2Client,SendEmailCommand } from '@aws-sdk/client-sesv2';
export const emailProviders=['local','ses-local','ses','resend'] as const;
export type EmailProvider=typeof emailProviders[number];
export type EmailContent={to:string;subject:string;text:string;html:string};
export function isEmailProvider(value:unknown):value is EmailProvider{return emailProviders.includes(value as EmailProvider);}
export function emailProviderOptions(env:NodeJS.ProcessEnv=process.env){
  const sender=Boolean(env.EMAIL_FROM);
  return [
    {value:'local',label:'Local file preview',configured:true,real_delivery:false,detail:'Messages appear in .local/mail.'},
    {value:'ses-local',label:'Amazon SES — local emulator',configured:true,real_delivery:false,detail:'LocalStack must be running on the configured local endpoint.'},
    {value:'ses',label:'Amazon SES — AWS',configured:sender,real_delivery:true,detail:sender?'Requires AWS credentials and a verified SES identity in the selected region.':'Set EMAIL_FROM and configure AWS access.'},
    {value:'resend',label:'Resend',configured:Boolean(env.RESEND_API_KEY&&(env.RESEND_FROM_EMAIL||sender)),real_delivery:true,detail:'Requires RESEND_API_KEY and a verified sender.'},
  ];
}
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderEmail(content:any,webOrigin=process.env.WEB_ORIGIN??'http://localhost:3000'):EmailContent{
  if(typeof content.to!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.to)||/[\r\n]/.test(content.to))throw new Error('INVALID_EMAIL_RECIPIENT');
  let subject:string,lines:string[];
  if(content.code){
    subject=content.purpose==='OWNER_RESET'||content.purpose==='PLATFORM_RESET'?'Reset your Invoice SaaS password':'Your Invoice SaaS verification code';
    lines=[`Your code is ${content.code}.`,'This code expires in five minutes. Do not share it.'];
  }else if(content.kind==='PAYMENT_SUCCESS'){
    subject=`Payment received${content.invoice_number?' — '+content.invoice_number:''}`;
    lines=[`Payment of INR ${Number(content.amount).toFixed(2)} has been confirmed.`, `Receipt: ${content.receipt_number}.`,
      'Payment confirmation is separate from bank settlement.','You can view your receipt from your authorized invoice portal or vendor workspace.'];
  }else if(content.kind==='PAYMENT_FAILED'){
    subject=`Payment was not completed${content.invoice_number?' — '+content.invoice_number:''}`;
    lines=['The payment attempt was not completed.',String(content.reason??'Return to your existing invoice link to check its status before retrying.')];
  }else if(content.link_token){
    subject=`${content.invoice_number?'Invoice '+content.invoice_number:'Your invoice'} — secure access link`;
    const link=new URL(`/pay/${encodeURIComponent(content.link_token)}`,webOrigin).toString();
    lines=[content.invoice_number?`Invoice ${content.invoice_number} is available.`:'Your invoice access link is available.',link,'This link expires in five days. You will need an email verification code to open the invoice.'];
  }else{
    subject=String(content.subject??'Invoice SaaS notification');
    lines=[String(content.message??content.reason??'There is an update in your Invoice SaaS workspace.')];
  }
  return {to:content.to,subject:subject.replace(/[\r\n]/g,' '),text:lines.join('\n\n'),html:`<div style="font-family:Arial,sans-serif;max-width:620px"><h2>${escape(subject)}</h2>${lines.map(line=>`<p>${escape(line)}</p>`).join('')}</div>`};
}
export async function sendEmail(provider:EmailProvider,message:EmailContent,jobId:string,env:NodeJS.ProcessEnv=process.env):Promise<string>{
  if(provider==='local')return `local:${jobId}`;
  const option=emailProviderOptions(env).find(p=>p.value===provider);
  if(!option?.configured)throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  if(provider==='resend'){
    if(!env.RESEND_API_KEY)throw new Error('RESEND_NOT_CONFIGURED');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`invoice-email/${jobId}`},body:JSON.stringify({from:env.RESEND_FROM_EMAIL??env.EMAIL_FROM,to:[message.to],subject:message.subject,text:message.text,html:message.html}),signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new Error(`RESEND_SEND_FAILED_${response.status}`);
    const result=await response.json() as {id?:string};if(!result.id)throw new Error('RESEND_RESPONSE_INVALID');return result.id;
  }
  const local=provider==='ses-local';
  if(local){const endpoint=new URL(env.SES_LOCAL_ENDPOINT??'http://127.0.0.1:4566');if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('SES_LOCAL_ENDPOINT_MUST_BE_LOOPBACK');}
  const client=new SESv2Client({region:env.AWS_REGION??'ap-southeast-1',maxAttempts:1,
    ...(local?{endpoint:env.SES_LOCAL_ENDPOINT??'http://127.0.0.1:4566',credentials:{accessKeyId:'test',secretAccessKey:'test'}}:{})});
  try{
    const result=await client.send(new SendEmailCommand({
      FromEmailAddress:local?(env.SES_LOCAL_FROM_EMAIL??'invoices@local.example'):env.EMAIL_FROM,
      Destination:{ToAddresses:[message.to]},
      Content:{Simple:{Subject:{Data:message.subject,Charset:'UTF-8'},Body:{Text:{Data:message.text,Charset:'UTF-8'},Html:{Data:message.html,Charset:'UTF-8'}}}},
      ...(env.SES_CONFIGURATION_SET&&!local?{ConfigurationSetName:env.SES_CONFIGURATION_SET}:{}),
      EmailTags:[{Name:'invoice_job_id',Value:jobId}]
    }),{abortSignal:AbortSignal.timeout(10_000)});
    if(!result.MessageId)throw new Error('SES_RESPONSE_INVALID');return result.MessageId;
  }catch(error){throw new Error(`SES_SEND_FAILED_${String((error as {name?:string}).name??'UNKNOWN').replace(/[^a-zA-Z0-9_]/g,'')}`);}
  finally{client.destroy();}
}
