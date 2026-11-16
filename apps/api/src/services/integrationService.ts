import { withPlatformOwner,type Database } from '@invoice/database';
import { emailProviderOptions,isEmailProvider } from '@invoice/email';
import type { Config } from '../config';
import { HttpError } from '../errors';
export function integrationService(db:Database,config:Config){
  return {
    async get(userId:string){
      return withPlatformOwner(db,userId,async client=>{
        const row=(await client.query("SELECT value FROM integration_settings WHERE key='email_delivery'")).rows[0];
        return {email_provider:row?.value.provider??process.env.DELIVERY_MODE??'local',email_options:emailProviderOptions(),
          payment:{driver:config.PAYMENT_DRIVER??'razorpay',mode:'TEST',configured:Boolean(config.RAZORPAY_KEY_ID&&config.RAZORPAY_KEY_SECRET),webhook_configured:Boolean(config.RAZORPAY_WEBHOOK_SECRET)}};
      });
    },
    async setEmail(userId:string,provider:unknown){
      if(!isEmailProvider(provider))throw new HttpError(422,'INVALID_EMAIL_PROVIDER','Choose a supported email provider.');
      if(!emailProviderOptions().find(o=>o.value===provider)?.configured)throw new HttpError(422,'EMAIL_PROVIDER_NOT_CONFIGURED','Configure the sender and provider credentials on the server first.');
      await withPlatformOwner(db,userId,client=>client.query(`INSERT INTO integration_settings(key,value,updated_by) VALUES('email_delivery',$1,$2)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify({provider}),userId]));
      return this.get(userId);
    }
  };
}
