'use client';
import { useEffect, useState, use } from 'react';
import Script from 'next/script';
declare global { interface Window { Razorpay?:new(options:Record<string,unknown>)=>{open:()=>void;on:(event:string,handler:(response:any)=>void)=>void}; } }

type Step = 'INSPECT' | 'OTP_REQUEST' | 'OTP_VERIFY' | 'INVOICE_VIEW' | 'PAYMENT_SUCCESS';

export default function CustomerPayPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [step, setStep] = useState<Step>('INSPECT');
  const [linkStatus, setLinkStatus] = useState<string>('CHECKING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [customerSession, setCustomerSession] = useState('');
  const [invoice, setInvoice] = useState<any>(null);

  // Payment form
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<'CHECKOUT_UPI' | 'PROVIDER_QR'>('CHECKOUT_UPI');
  const [paymentSuccess, setPaymentSuccess] = useState<any>(null);
  const [checkoutReady,setCheckoutReady]=useState(false);
  const [activeAttempt,setActiveAttempt]=useState<any>(null);
  const [pending,setPending]=useState(false);
  const [receiptDocuments,setReceiptDocuments]=useState<any[]>([]);
  const [courseCertificates,setCourseCertificates]=useState<any[]>([]);

  useEffect(() => {
    checkLink();
  }, [token]);

  async function checkLink() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/public/invoice-links/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Link unavailable');
      setLinkStatus(data.data.status);
      if (data.data.status === 'VALID') {
        setStep('OTP_REQUEST');
      }
    } catch (e: any) {
      setError(e.message);
      setLinkStatus('UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/public/invoice-links/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed to send OTP');
      setChallengeId(data.data.challenge_id);
      setStep('OTP_VERIFY');
      setNotice('Verification code sent to your registered email address.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/public/invoice-links/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_token: token, challenge_id: challengeId, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Invalid code');
      setCustomerSession(data.data.session_token);
      await loadInvoice(data.data.session_token);
      setStep('INVOICE_VIEW');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function renewLink() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/public/invoice-links/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Renewal failed');
      setNotice('A fresh 5-day invoice link has been sent to your registered email.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadInvoice(sessToken: string) {
    const res = await fetch('/api/v1/customer/invoice', {
      headers: { Authorization: `Bearer ${sessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load invoice');
    setInvoice(data.data);
    setPayAmount(data.data.outstanding_amount);
  }

  useEffect(()=>{
    if(!invoice?.id||!customerSession)return;
    let disposed=false,count=0;
    const update=async()=>{try{const response=await fetch('/api/v1/customer/invoice/documents',{headers:{Authorization:`Bearer ${customerSession}`}});const result=await response.json();if(response.ok&&!disposed)setCourseCertificates(result.data.filter((document:any)=>document.kind==='COURSE_CERTIFICATE'));}catch{}};
    void update();const timer=setInterval(()=>{if(++count>20)clearInterval(timer);else void update();},3000);
    return()=>{disposed=true;clearInterval(timer);};
  },[invoice?.id,customerSession]);

  async function finishPayment(result:any){
    if(result.status!=='SUCCEEDED')return false;
    await loadInvoice(customerSession);
    setPaymentSuccess({amount:Number(result.requested_amount??payAmount),order_id:result.external_order_id,method:payMethod});
    setStep('PAYMENT_SUCCESS');setPending(false);setNotice('Payment confirmed successfully!');return true;
  }
  async function checkPayment(){
    if(!activeAttempt)return;
    setBusy(true);setError('');
    try{
      const res=await fetch(`/api/v1/customer/payment-attempts/${activeAttempt.attempt_id}/reconcile`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${customerSession}`},body:'{}'});
      const response=await res.json();if(!res.ok)throw new Error(response.error?.message??'Unable to check payment.');
      setActiveAttempt(response.data);
      if(!await finishPayment(response.data)){setPending(true);setNotice('Payment is not yet confirmed. You can check again or resume the existing checkout.');}
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  useEffect(()=>{
    if(!activeAttempt?.attempt_id||!customerSession||!pending)return;
    let disposed=false,count=0;
    const timer=setInterval(async()=>{
      if(++count>18){clearInterval(timer);return;}
      try{
        const response=await fetch(`/api/v1/customer/payment-attempts/${activeAttempt.attempt_id}`,{headers:{Authorization:`Bearer ${customerSession}`}});
        const result=await response.json();if(disposed||!response.ok)return;
        if(result.data.status==='SUCCEEDED'){clearInterval(timer);await finishPayment(result.data);}
        else if(result.data.last_error_code==='PAYMENT_FAILED')setNotice('The last payment was not completed. Check its status before retrying.');
      }catch{/* Keep the attempt available for explicit reconciliation. */}
    },10_000);
    return()=>{disposed=true;clearInterval(timer);};
  },[activeAttempt?.attempt_id,customerSession,pending]);
  useEffect(()=>{
    if(step!=='PAYMENT_SUCCESS')return;
    let disposed=false,count=0;
    const update=async()=>{
      try{const res=await fetch('/api/v1/customer/invoice/documents',{headers:{Authorization:`Bearer ${customerSession}`}});const result=await res.json();if(!disposed&&res.ok)setReceiptDocuments(result.data.filter((d:any)=>d.kind==='RECEIPT_PDF'));}catch{}
    };
    void update();const timer=setInterval(()=>{if(++count>10)clearInterval(timer);else void update();},2000);
    return()=>{disposed=true;clearInterval(timer);};
  },[step,customerSession]);

  async function makeTestPayment(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const amount=Number(payAmount);
      const res=await fetch('/api/v1/customer/payment-attempts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${customerSession}`},body:JSON.stringify({amount,method:payMethod,request_key:crypto.randomUUID()})});
      const result=await res.json();
      if(!res.ok){
        if(result.error?.details?.attempt_id){setActiveAttempt({attempt_id:result.error.details.attempt_id});setPending(true);}
        throw new Error(result.error?.message??'Could not create payment order.');
      }
      const attempt=result.data;setActiveAttempt(attempt);
      if(await finishPayment(attempt))return;
      if(attempt.driver==='simulation'){
        const simulated=await fetch(`/api/v1/customer/payment-attempts/${attempt.attempt_id}/simulate`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${customerSession}`},body:'{}'});
        const confirmed=await simulated.json();if(!simulated.ok)throw new Error(confirmed.error?.message??'Simulation failed');
        await finishPayment({...attempt,status:confirmed.data.status});return;
      }
      if(!attempt.checkout){setPending(true);setNotice('The order is being confirmed with Razorpay. Check its status before retrying.');return;}
      if(!checkoutReady||!window.Razorpay)throw new Error('Razorpay Checkout is still loading. Please try again.');
      const checkout=new window.Razorpay({...attempt.checkout,
        prefill:{email:invoice.customer_snapshot?.email,name:invoice.customer_snapshot?.name},theme:{color:'#163b43'},
        handler:async(response:any)=>{
          setBusy(true);
          try{
            const verify=await fetch(`/api/v1/customer/payment-attempts/${attempt.attempt_id}/checkout-result`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${customerSession}`},body:JSON.stringify({provider_order_id:response.razorpay_order_id,provider_payment_id:response.razorpay_payment_id,provider_signature:response.razorpay_signature})});
            const verified=await verify.json();if(!verify.ok)throw new Error(verified.error?.message??'Payment confirmation is pending.');
            if(!await finishPayment(verified.data)){setPending(true);setNotice('Payment is authorized and awaiting capture. This is not yet a confirmed payment.');}
          }catch(error:any){setError(error.message);setPending(true);}finally{setBusy(false);}
        },modal:{ondismiss:()=>{setBusy(false);setPending(true);setNotice('Checkout closed. Check payment status or resume the same checkout.');}}
      });
      checkout.on('payment.failed',()=>{setError('The payment was not completed. Check its status before retrying.');setPending(true);setBusy(false);});
      setPending(true);checkout.open();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }

  return (
    <>
    {invoice&&invoice.payment_options?.driver!=='simulation'&&<Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onReady={()=>setCheckoutReady(true)} onError={()=>setError('Razorpay Checkout could not be loaded. Check your connection and retry.')}/>}
    <div style={{ minHeight: '100dvh', background: '#f6f6f1', padding: '40px 20px', display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 650, width: '100%', background: 'white', border: '1px solid #d8e2d1', borderRadius: 10, padding: 36, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1px solid #eef2e7', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: '#d5edb6', color: '#163b43', width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', fontWeight: 'bold' }}>i</div>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#163b43' }}>Invoice Portal</span>
          </div>
          <span style={{ fontSize: 10, letterSpacing: 1, color: '#526c58', background: '#eef5e6', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>SECURE ACCESS</span>
        </div>

        {error && <div className="message error" style={{ marginBottom: 20 }}>{error}</div>}
        {notice && <div className="message success" style={{ marginBottom: 20 }}>{notice}</div>}

        {/* Link Status = UNAVAILABLE */}
        {linkStatus === 'UNAVAILABLE' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <h3 style={{ fontFamily: 'Georgia, serif', color: '#8c4031' }}>Invoice Link Unavailable</h3>
            <p style={{ color: '#687c82', fontSize: 14 }}>This link has been revoked, superseded, or the business is currently unavailable.</p>
          </div>
        )}

        {/* Link Status = EXPIRED */}
        {linkStatus === 'EXPIRED' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <h3 style={{ fontFamily: 'Georgia, serif' }}>Invoice Link Expired</h3>
            <p style={{ color: '#687c82', fontSize: 14 }}>Invoice links expire after 5 days for your security. You can request a fresh link at any time.</p>
            <button className="btn primary" style={{ marginTop: 20 }} disabled={busy} onClick={renewLink}>Email Fresh Invoice Link →</button>
          </div>
        )}

        {/* STEP: OTP_REQUEST */}
        {step === 'OTP_REQUEST' && linkStatus === 'VALID' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: '0 0 12px' }}>Verify Your Identity</h2>
            <p style={{ color: '#687c82', fontSize: 14, lineHeight: 1.6, maxWidth: 440, margin: '0 auto 24px' }}>
              To view this invoice and make payments securely, we will send a 6-digit one-time code to the email address on file.
            </p>
            <button className="btn primary" style={{ padding: '12px 28px' }} disabled={busy} onClick={requestOtp}>
              {busy ? 'Sending…' : 'Send Verification Code →'}
            </button>
          </div>
        )}

        {/* STEP: OTP_VERIFY */}
        {step === 'OTP_VERIFY' && (
          <div style={{ maxWidth: 380, margin: '10px auto' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: '0 0 10px' }}>Enter Code</h2>
            <p style={{ color: '#687c82', fontSize: 13, marginBottom: 20 }}>Check your inbox for the 6-digit verification code.</p>
            <form onSubmit={verifyOtp}>
              <label>6-Digit Verification Code</label>
              <input inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={code} onChange={e => setCode(e.target.value)} required />
              <button className="btn primary" style={{ width: '100%', marginTop: 20, padding: 12 }} type="submit" disabled={busy}>
                {busy ? 'Verifying…' : 'Open Invoice (15-min session) →'}
              </button>
            </form>
          </div>
        )}

        {/* STEP: INVOICE_VIEW */}
        {step === 'INVOICE_VIEW' && invoice && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <span className="badge issued">{invoice.document_state}</span>
                <h2 style={{ fontFamily: 'Georgia, serif', margin: '6px 0 2px' }}>{invoice.invoice_number ?? 'INVOICE'}</h2>
                <div style={{ fontSize: 12, color: '#687c82' }}>Date: {invoice.invoice_date} {invoice.due_date && `| Due: ${invoice.due_date}`}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#687c82' }}>Outstanding Balance</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: invoice.outstanding_amount === 0 ? '#2e6930' : '#163b43', fontFamily: 'Georgia, serif' }}>
                  ₹{invoice.outstanding_amount.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Line items table */}
            <div style={{ border: '1px solid #eef2e7', borderRadius: 6, overflow: 'hidden', margin: '20px 0' }}>
              <table style={{ margin: 0 }}>
                <thead style={{ background: '#f9faf6' }}>
                  <tr>
                    <th>Item Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines?.map((l: any, i: number) => (
                    <tr key={i}>
                      <td><strong>{l.description}</strong></td>
                      <td>{l.quantity} {l.unit}</td>
                      <td>₹{l.unit_price}</td>
                      <td>₹{l.line_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '16px 0' }}>
              <div style={{ width: 220, fontSize: 13, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal:</span><span>₹{invoice.subtotal}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax:</span><span>₹{invoice.tax_total}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #d8e2d1', paddingTop: 6, fontWeight: 700, fontSize: 15 }}>
                  <span>Total Amount:</span><span>₹{invoice.total}</span>
                </div>
              </div>
            </div>

            {/* Actions: Download PDF & Renew Link */}
            <div style={{ display: 'flex', gap: 10, margin: '20px 0', borderTop: '1px solid #eef2e7', paddingTop: 16 }}>
              <a className="btn secondary sm" href={`/api/v1/customer/invoice/document/content`} target="_blank" rel="noreferrer">
                📄 Download PDF
              </a>
              {courseCertificates.map((document,index)=><a key={document.id} className="btn secondary sm" href={`/api/v1/customer/documents/${document.id}/content`} target="_blank" rel="noreferrer">Download certificate {index+1}</a>)}
              <button className="btn secondary sm" disabled={busy} onClick={renewLink}>
                🔄 Email Fresh 5-Day Link
              </button>
            </div>

            {/* Payment Section (if outstanding > 0) */}
            {invoice.can_pay ? (
              <div style={{ background: '#f5f7f2', border: '1px solid #d8e2d1', borderRadius: 8, padding: 20, marginTop: 20 }}>
                <h3 style={{ margin: '0 0 10px', fontFamily: 'Georgia, serif', fontSize: 18 }}>Pay Online (Test Checkout)</h3>
                {invoice.payment_options?.driver!=='simulation'&&<p>Razorpay Test Mode · No real money is charged. Available methods depend on your Razorpay test account. UPI Intent and QR require Live Mode.</p>}
                <form onSubmit={makeTestPayment}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label>Payment Amount (₹)</label>
                      <input
                        type="number"
                        min={1}
                        max={invoice.outstanding_amount}
                        value={payAmount}
                        onChange={e => setPayAmount(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div>
                      <label>Method</label>
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value as any)}>
                        <option value="CHECKOUT_UPI">{invoice.payment_options?.driver==='simulation'?'UPI (local simulation)':'Razorpay Checkout (Test Mode)'}</option>
                        {invoice.payment_options?.driver==='simulation'&&<option value="PROVIDER_QR">QR (local simulation)</option>}
                      </select>
                    </div>
                  </div>
                  <button className="btn primary" style={{ width: '100%', marginTop: 16, padding: 12 }} type="submit" disabled={busy}>
                    {busy ? 'Processing…' : invoice.payment_options?.driver==='simulation' ? `Simulate Pay ₹${payAmount} →` : `${activeAttempt?'Resume checkout':'Pay'} ₹${payAmount} with Razorpay →`}
                  </button>
                </form>
              </div>
            ) : (
              <div style={{ background: '#eaf5ea', border: '1px solid #c3e2be', borderRadius: 8, padding: 16, textAlign: 'center', marginTop: 20 }}>
                <strong style={{ color: '#2e6930' }}>✓ This invoice is fully paid. Thank you!</strong>
              </div>
            )}
          </div>
        )}

        {pending&&step==='INVOICE_VIEW'&&<div style={{marginTop:16}}><button className="btn secondary" disabled={busy} onClick={()=>void checkPayment()}>Check payment status</button></div>}

        {/* STEP: PAYMENT_SUCCESS */}
        {step === 'PAYMENT_SUCCESS' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 44, color: '#2e6930', marginBottom: 12 }}>✓</div>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: '0 0 8px' }}>Payment Confirmed</h2>
            <p style={{ color: '#687c82', fontSize: 14, marginBottom: 20 }}>
              Payment of <strong>₹{paymentSuccess?.amount}</strong> was verified and applied to your invoice.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn primary sm" onClick={() => setStep('INVOICE_VIEW')}>View Updated Invoice</button>
              {receiptDocuments.length===0&&<span>Preparing your receipt…</span>}
              {receiptDocuments.map(doc=><a key={doc.id} className="btn secondary sm" href={`/api/v1/customer/documents/${doc.id}/content`} target="_blank" rel="noreferrer">Download receipt</a>)}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
