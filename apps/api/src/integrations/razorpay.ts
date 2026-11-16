import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';
import { HttpError } from '../errors';

export type RazorpayOrder={id:string;amount:number;currency:string;status:string;receipt:string;notes?:Record<string,string>};
export type RazorpayPayment={id:string;order_id:string;amount:number;currency:string;status:string;captured?:boolean;method?:string;notes?:Record<string,string>;error_description?:string};
export function amountInPaise(amount:number){
  const paise=Math.round(amount*100);
  if(!Number.isSafeInteger(paise)||paise<=0||Math.abs(amount*100-paise)>0.00001)throw new HttpError(422,'INVALID_AMOUNT','Use a positive amount with at most two decimal places.');
  return paise;
}
export function validSignature(value:string,signature:string,secret:string){
  return /^[a-f0-9]{64}$/i.test(signature)&&timingSafeEqual(createHmac('sha256',secret).update(value).digest(),Buffer.from(signature,'hex'));
}
export function razorpayClient(config:Config){
  const key=config.RAZORPAY_KEY_ID,secret=config.RAZORPAY_KEY_SECRET;
  if(!key?.startsWith('rzp_test_')||!secret)throw new HttpError(503,'RAZORPAY_NOT_CONFIGURED','Razorpay Test Mode credentials have not been configured.');
  async function call<T>(method:string,path:string,body?:unknown):Promise<T>{
    let response:Response;
    try{response=await fetch(`https://api.razorpay.com/v1${path}`,{
      method,headers:{Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12_000)
    });}catch{throw new HttpError(503,'PROVIDER_RESULT_UNKNOWN','The payment provider could not be reached. Check this attempt before trying again.');}
    if(!response.ok)throw new HttpError(response.status>=500?503:502,response.status>=500?'PROVIDER_RESULT_UNKNOWN':'PROVIDER_REQUEST_REJECTED','Razorpay could not complete the request. Check server configuration and retry the existing attempt.');
    return await response.json() as T;
  }
  return {
    keyId:key,
    createOrder:(amount:number,receipt:string,notes:Record<string,string>)=>call<RazorpayOrder>('POST','/orders',{amount,currency:'INR',receipt,notes}),
    getOrder:(id:string)=>call<RazorpayOrder>('GET',`/orders/${encodeURIComponent(id)}`),
    getPayment:(id:string)=>call<RazorpayPayment>('GET',`/payments/${encodeURIComponent(id)}`),
    getOrderPayments:(id:string)=>call<{items:RazorpayPayment[]}>('GET',`/orders/${encodeURIComponent(id)}/payments`),
    findOrders:(receipt:string)=>call<{items:RazorpayOrder[]}>('GET',`/orders?receipt=${encodeURIComponent(receipt)}&count=100`),
  };
}
