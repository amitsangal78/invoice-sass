'use client';
import { useEffect, useRef, useState } from 'react';
import type { Actor } from '@invoice/contracts';

type AuthMode = 'LOGIN' | 'SIGNUP' | 'OWNER_OTP' | 'PASSWORD_RESET';
type OwnerTab = 'DASHBOARD' | 'INVOICES' | 'CREATORS' | 'CUSTOMERS' | 'CATALOGUE' | 'PAYMENTS' | 'PROFILE';
type CreatorTab = 'INVOICES';
type AdminTab = 'DASHBOARD' | 'VENDORS' | 'CHANGE_REQUESTS' | 'JOBS' | 'INTEGRATIONS';

async function api(path: string, body?: unknown, method?: string, key?: string) {
  const m = method ?? (body ? 'POST' : 'GET');
  const res = await fetch(`/api/v1${path}`, {
    method: m,
    credentials: 'same-origin',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message ?? 'Unable to complete the request.');
  return result.data;
}

function canIssueInvoice(invoice:any){
  if(invoice.document_state!=='UNISSUED')return false;
  return invoice.origin==='CREATOR'?invoice.approval_state==='SUBMITTED':['DRAFT','REWORK','SUBMITTED'].includes(invoice.approval_state);
}

export default function Page() {
  const [authMode, setAuthMode] = useState<AuthMode>('LOGIN');
  const [actor, setActor] = useState<Actor | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [resetGrant, setResetGrant] = useState('');

  // Tabs
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('DASHBOARD');
  const [adminTab, setAdminTab] = useState<AdminTab>('DASHBOARD');

  // Domain data
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [creators, setCreators] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [catalogueItems, setCatalogueItems] = useState<any[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [vendorInfo, setVendorInfo] = useState<any>(null);
  const [adminVendors, setAdminVendors] = useState<any[]>([]);
  const [adminRequests, setAdminRequests] = useState<any[]>([]);
  const [adminJobs, setAdminJobs] = useState<any[]>([]);

  const [integrations,setIntegrations]=useState<any>(null);
  const [emailProvider,setEmailProvider]=useState('local');

  const [adminVendorDetails,setAdminVendorDetails]=useState<any>(null);
  const [adminRequestId,setAdminRequestId]=useState<string|null>(null);
  const [reviewDecision,setReviewDecision]=useState<'APPROVE'|'REJECT'|'MORE_INFO'>('APPROVE');
  const [reviewReason,setReviewReason]=useState('');

  // Modals
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const [showCatalogueModal,setShowCatalogueModal]=useState(false);
  const [showTaxModal,setShowTaxModal]=useState(false);
  const emptyCatalogueForm={name:'',item_type:'PRODUCT' as 'PRODUCT'|'SERVICE',unit:'piece',unit_price:'',sku:'',hsn_sac:'',tax_profile_id:''};
  const [catalogueForm,setCatalogueForm]=useState(emptyCatalogueForm);
  const [taxForm,setTaxForm]=useState({name:'',mode:'GST' as 'GST'|'NONE',components:[{name:'',rate:''}]});

  // Invoice draft form
  const [invCustomer, setInvCustomer] = useState('');
  const [invDueDate, setInvDueDate] = useState('');
  const [invLines, setInvLines] = useState<{ catalogue_item_id: string; quantity: number; unit_price?: number; discount_amount?:number }[]>([
    { catalogue_item_id: '', quantity: 1 },
  ]);

  const [invTemplate,setInvTemplate]=useState<'STANDARD'|'COURSE'|'UDEMY'|'SERVICE'>('STANDARD');
  const [invOrderReference,setInvOrderReference]=useState('');
  const [invPlaceOfSupply,setInvPlaceOfSupply]=useState('');
  const [invShippingAddress,setInvShippingAddress]=useState('');
  const [invServiceStart,setInvServiceStart]=useState('');
  const [invServiceEnd,setInvServiceEnd]=useState('');
  const [invNotes,setInvNotes]=useState('');
  const [invCourseCertificate,setInvCourseCertificate]=useState(false);
  const [invCertificateStyle,setInvCertificateStyle]=useState<'NAMASTEDEV'|'UDEMY'>('NAMASTEDEV');
  const [invCertificateType,setInvCertificateType]=useState<'COURSE'|'COMPLETION'>('COURSE');
  const [invCertificateName,setInvCertificateName]=useState('');
  const [invCertificateCourse,setInvCertificateCourse]=useState('');
  const [invCertificateInstructor,setInvCertificateInstructor]=useState('');
  const [invCertificateDate,setInvCertificateDate]=useState(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
  const [invoicePreviewUrl,setInvoicePreviewUrl]=useState<string|null>(null);
  const [invoiceDocuments,setInvoiceDocuments]=useState<any[]>([]);
  const [certificateForInvoice,setCertificateForInvoice]=useState<any>(null);
  const [certificateRequestKey,setCertificateRequestKey]=useState('');

  useEffect(()=>()=>{if(invoicePreviewUrl)URL.revokeObjectURL(invoicePreviewUrl);},[invoicePreviewUrl]);
  useEffect(()=>{if(!showInvoiceModal)setInvoicePreviewUrl(null);},[showInvoiceModal]);
  useEffect(()=>{
    setInvoiceDocuments([]);if(!selectedInvoice||selectedInvoice.document_state!=='ISSUED')return;
    let disposed=false,attempts=0;
    const update=async()=>{try{const result=await api(`/invoices/${selectedInvoice.id}/documents`);if(!disposed)setInvoiceDocuments(result);}catch{}};
    void update();const timer=setInterval(()=>{if(++attempts>20)clearInterval(timer);else void update();},3000);
    return()=>{disposed=true;clearInterval(timer);};
  },[selectedInvoice?.id,selectedInvoice?.current_revision_no]);

  function invoiceDraftPayload(){
    const lines=invLines.filter(l=>l.catalogue_item_id);
    const customer=customers.find(c=>c.id===invCustomer);
    const course=invCertificateCourse.trim()||lines.map(line=>catalogueItems.find(item=>item.id===line.catalogue_item_id)?.name??'').filter(Boolean).join(', ');
    return {customer_id:invCustomer,due_date:invDueDate||undefined,lines,
      document_options:{template:invTemplate,order_reference:invOrderReference||undefined,place_of_supply:invPlaceOfSupply||undefined,shipping_address:invShippingAddress||undefined,
        service_start:invServiceStart||undefined,service_end:invServiceEnd||undefined,notes:invNotes||undefined,
        certificates:invCourseCertificate?[{style:invCertificateStyle,certificate_type:invCertificateType,recipient_name:invCertificateName.trim()||customer?.name||'',course_name:course,awarded_on:invCertificateDate,instructor_name:invCertificateInstructor||undefined}]:[]}};
  }
  async function openExistingCertificate(invoice:any){
    await act(async()=>{
      const detail=await api(`/invoices/${invoice.id}`);
      setInvCertificateName(detail.customer_snapshot?.name??detail.customer_name??'');setInvCertificateCourse((detail.lines??[]).map((line:any)=>line.description).join(', '));
      setInvCertificateStyle(detail.document_options?.template==='UDEMY'?'UDEMY':'NAMASTEDEV');setInvCertificateType('COURSE');setInvCertificateInstructor('');setInvCertificateDate(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
      setCertificateRequestKey(crypto.randomUUID());setSelectedInvoice(null);setCertificateForInvoice(detail);
    });
  }

  async function previewInvoiceDocument(kind:'invoice'|'certificate'){
    await act(async()=>{
      if(!invCustomer||!invLines.some(line=>line.catalogue_item_id))throw new Error('Select a customer and at least one item before previewing.');
      const response=await fetch(`/api/v1/invoices/preview-${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(invoiceDraftPayload())});
      if(!response.ok){const result=await response.json();throw new Error(result.error?.message??'Unable to generate preview.');}
      setInvoicePreviewUrl(URL.createObjectURL(await response.blob()));
    });
  }

  // Creator form
  const [newCreatorEmail, setNewCreatorEmail] = useState('');
  const [newCreatorPassword, setNewCreatorPassword] = useState('');
  const [newCreatorStatus, setNewCreatorStatus] = useState<'ACTIVE' | 'FROZEN'>('ACTIVE');

  // Customer form
  const [custName, setCustName] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custCity, setCustCity] = useState('');
  const [custLine1, setCustLine1] = useState('');
  const [custState, setCustState] = useState('');
  const [custPostal, setCustPostal] = useState('');

  const signupKey = useRef<{ payload: string; key: string } | null>(null);

  useEffect(() => {
    api('/auth/me')
      .then(user => {
        setActor(user);
        loadWorkspace(user);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  async function loadWorkspace(user: Actor) {
    if (user.role === 'OWNER') {
      try {
        const [dash, invs, crs, custs, items, taxes, pays, prof, vend] = await Promise.all([
          api('/dashboard').catch(() => null),
          api('/invoices').catch(() => []),
          api('/vendor/creators').catch(() => []),
          api('/customers').catch(() => []),
          api('/catalogue-items').catch(() => []),
          api('/tax-profiles').catch(() => []),
          api('/payments').catch(() => []),
          api('/vendor/profile').catch(() => null),
          api('/vendor').catch(() => null),
        ]);
        setDashboardData(dash);
        setInvoices(invs);
        setCreators(crs);
        setCustomers(custs);
        setCatalogueItems(items);
        setTaxProfiles(taxes);
        setPayments(pays);
        setProfile(prof);
        setVendorInfo(vend);
      } catch {}
    } else if (user.role === 'CREATOR') {
      try {
        const [invs, custs, items] = await Promise.all([
          api('/invoices').catch(() => []),
          api('/invoice-options/customers').catch(() => []),
          api('/invoice-options/items').catch(() => []),
        ]);
        setInvoices(invs);
        setCustomers(custs);
        setCatalogueItems(items);
      } catch {}
    } else if (user.role === 'PLATFORM_OWNER') {
      try {
        const [dash, vends, reqs, jobs] = await Promise.all([
          api('/admin/dashboard').catch(() => null),
          api('/admin/vendors').catch(() => []),
          api('/admin/change-requests?status=SUBMITTED').catch(() => []),
          api('/admin/jobs').catch(() => []),
        ]);
        setDashboardData(dash);
        setAdminVendors(vends);
        setAdminRequests(reqs);
        setAdminJobs(jobs);
        const settings=await api('/admin/integrations');
        setIntegrations(settings);setEmailProvider(settings.email_provider);
      } catch {}
    }
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e: any) {
      setError(e instanceof Error ? e.message : 'Unable to complete the action.');
    } finally {
      setBusy(false);
    }
  }

  async function openVendorReview(vendorId:string,requestId?:string,decision:'APPROVE'|'REJECT'|'MORE_INFO'='APPROVE'){
    await act(async()=>{
      const detail=await api(`/admin/vendors/${vendorId}`);
      setAdminVendorDetails(detail);setAdminRequestId(requestId??detail.change_requests.find((request:any)=>request.kind==='ONBOARDING'&&request.status==='SUBMITTED')?.id??null);
      setReviewDecision(decision);setReviewReason('');
    });
  }
  const selectedAdminRequest=adminVendorDetails?.change_requests?.find((request:any)=>request.id===adminRequestId);
  const reviewProfile=selectedAdminRequest?.proposed_profile??adminVendorDetails?.profile;

  // Auth Submit
  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    await act(async () => {
      if (authMode === 'SIGNUP') {
        const payload = JSON.stringify({ email, password });
        if (signupKey.current?.payload !== payload) signupKey.current = { payload, key: crypto.randomUUID() };
        await api('/auth/signup', { email, password }, 'POST', signupKey.current.key);
      } else if (authMode === 'LOGIN') {
        await api('/auth/login', { email, password, client_type: 'WEB' });
      } else if (authMode === 'OWNER_OTP') {
        if (!challengeId) {
          const res = await api('/auth/owner-otp/challenges', { email });
          setChallengeId(res.challenge_id);
          setNotice('OTP code sent. In local dev, check .local/mail after running worker.');
          return;
        } else {
          await api('/auth/owner-otp/verify', { challenge_id: challengeId, code, client_type: 'WEB' });
        }
      } else if (authMode === 'PASSWORD_RESET') {
        if (!challengeId) {
          const res = await api('/auth/password-recovery/challenges', { email });
          setChallengeId(res.challenge_id);
          setNotice('Reset code sent to your email.');
          return;
        } else if (!resetGrant) {
          const res = await api('/auth/password-recovery/verify', { challenge_id: challengeId, code });
          setResetGrant(res.reset_grant);
          setNotice('Enter your new password below.');
          return;
        } else {
          await api('/auth/password-recovery/complete', { reset_grant: resetGrant, new_password: password });
          setNotice('Password reset successfully. Please log in.');
          setAuthMode('LOGIN');
          setPassword('');
          return;
        }
      }
      setPassword('');
      setCode('');
      const me = await api('/auth/me');
      setActor(me);
      await loadWorkspace(me);
    });
  }

  return (
    <main className="shell">
      <aside className="story">
        <a className="brand" href="/">
          <span className="brand-icon">i</span> invoice<span className="brand-light">workspace</span>
        </a>
        <div className="story-body">
          <span className="eyebrow">INTELLIGENT BILLING & RECONCILIATION</span>
          <h1>Your business.<br />One clear view.</h1>
          <p>Prepare invoices with confidence, manage team permissions, and track verified collections.</p>
        </div>
        <p className="pilot-note">
          <span className="dot" /> Internal pilot · Test mode only
        </p>
      </aside>

      <section className="workspace">
        <header>
          <span className="subtle">INVOICE WORKSPACE</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="test-pill">SIMULATED TEST MODE</span>
            {actor && (
              <button
                className="btn secondary sm"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api('/auth/logout', {});
                    setActor(null);
                    setAuthMode('LOGIN');
                  })
                }
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        {checking ? (
          <p role="status">Opening your workspace…</p>
        ) : !actor ? (
          <div style={{ maxWidth: 420, margin: '40px auto', width: '100%' }}>
            <span className="eyebrow dark">ACCESS YOUR ACCOUNT</span>
            <h2 style={{ fontFamily: 'Georgia, serif', margin: '12px 0 24px' }}>
              {authMode === 'LOGIN' && 'Welcome back.'}
              {authMode === 'SIGNUP' && 'Start your workspace.'}
              {authMode === 'OWNER_OTP' && 'Owner OTP login'}
              {authMode === 'PASSWORD_RESET' && 'Reset your password'}
            </h2>

            <div className="nav-bar" style={{ marginBottom: 20 }}>
              <button className={`nav-tab ${authMode === 'LOGIN' ? 'active' : ''}`} onClick={() => { setAuthMode('LOGIN'); setError(''); setNotice(''); }}>Sign in</button>
              <button className={`nav-tab ${authMode === 'SIGNUP' ? 'active' : ''}`} onClick={() => { setAuthMode('SIGNUP'); setError(''); setNotice(''); }}>Create account</button>
              <button className={`nav-tab ${authMode === 'OWNER_OTP' ? 'active' : ''}`} onClick={() => { setAuthMode('OWNER_OTP'); setError(''); setNotice(''); setChallengeId(''); }}>Owner OTP</button>
              <button className={`nav-tab ${authMode === 'PASSWORD_RESET' ? 'active' : ''}`} onClick={() => { setAuthMode('PASSWORD_RESET'); setError(''); setNotice(''); setChallengeId(''); setResetGrant(''); }}>Reset password</button>
            </div>

            {error && <div className="message error">{error}</div>}
            {notice && <div className="message success">{notice}</div>}

            <form onSubmit={submitAuth}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />

              {authMode !== 'OWNER_OTP' && (!resetGrant || authMode !== 'PASSWORD_RESET') && (
                <>
                  <label htmlFor="pwd">{resetGrant ? 'New Password' : 'Password'}</label>
                  <input id="pwd" type="password" minLength={authMode === 'SIGNUP' ? 12 : 1} value={password} onChange={e => setPassword(e.target.value)} required />
                </>
              )}

              {challengeId && !resetGrant && (
                <>
                  <label htmlFor="code">Email verification code</label>
                  <input id="code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value)} required />
                </>
              )}

              <button className="btn primary" style={{ width: '100%', marginTop: 24, padding: 14 }} disabled={busy} type="submit">
                {busy ? 'Please wait…' : authMode === 'SIGNUP' ? 'Create workspace' : authMode === 'LOGIN' ? 'Sign in to workspace' : authMode === 'OWNER_OTP' && !challengeId ? 'Send OTP code →' : 'Continue →'}
              </button>
            </form>
          </div>
        ) : (
          <div>
            {/* Header info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <span className="eyebrow dark">WELCOME BACK</span>
                <h2 style={{ fontFamily: 'Georgia, serif', margin: '4px 0' }}>Your workspace</h2>
                <p className="intro" style={{ margin: '4px 0 10px', fontSize: 13, color: 'var(--muted)' }}>Signed in as <strong>{actor.email}</strong></p>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <span className="badge active">{actor.role.replaceAll('_', ' ')}</span>
                  {actor.vendor_status && <span className={`badge ${actor.vendor_status.toLowerCase()}`}>{actor.vendor_status}</span>}
                  <span>{actor.restricted ? 'Email verification required' : 'Email verified'}</span>
                </div>
              </div>
            </div>

            <div className="account-card" style={{ marginBottom: 20 }}>
              <span className="card-label">BUSINESS STATUS</span>
              <h3>{actor.vendor_status ?? actor.role.replaceAll('_', ' ')}</h3>
              <p>{actor.vendor_status === 'DRAFT' ? 'Your account is ready. Business onboarding is the next implementation milestone.' : 'Your current account status is shown above.'}</p>
            </div>

            {error && <div className="message error">{error}</div>}
            {notice && <div className="message success">{notice}</div>}

            {/* Email verification prompt if restricted */}
            {actor.restricted && (
              <div className="card" style={{ borderColor: '#e4cd91', background: '#fdfbf6' }}>
                <h3 style={{ color: '#8a6409' }}>Please verify your email</h3>
                <p style={{ fontSize: 13, color: '#687c82' }}>Your account is restricted until you verify your email address.</p>
                <div style={{ display: 'flex', gap: 10, maxWidth: 450, marginTop: 12 }}>
                  <button className="btn secondary sm" disabled={busy} onClick={() => void act(async () => {
                    const r = await api('/auth/email-verifications', { email: actor.email, purpose: 'EMAIL_VERIFY' });
                    setChallengeId(r.challenge_id);
                    setNotice('Verification code requested. Check .local/mail.');
                  })}>Request verification code</button>
                  {challengeId && (
                    <form style={{ display: 'flex', gap: 6, alignItems: 'center' }} onSubmit={e => {
                      e.preventDefault();
                      void act(async () => {
                        await api('/auth/email-verifications/verify', { challenge_id: challengeId, code });
                        const updated = await api('/auth/me');
                        setActor(updated);
                        setNotice('Email verified.');
                      });
                    }}>
                      <label htmlFor="auth-code" style={{ display: 'none' }}>Email verification code</label>
                      <input id="auth-code" placeholder="6-digit code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} style={{ width: 140, height: 36, padding: '4px 8px' }} />
                      <button className="btn primary sm" type="submit" disabled={busy}>Verify email</button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* VENDOR OWNER WORKSPACE */}
            {actor.role === 'OWNER' && (
              <div>
                <div className="nav-bar">
                  <button className={`nav-tab ${ownerTab === 'DASHBOARD' ? 'active' : ''}`} onClick={() => setOwnerTab('DASHBOARD')}>Dashboard</button>
                  <button className={`nav-tab ${ownerTab === 'INVOICES' ? 'active' : ''}`} onClick={() => setOwnerTab('INVOICES')}>Invoices ({invoices.length})</button>
                  <button className={`nav-tab ${ownerTab === 'CREATORS' ? 'active' : ''}`} onClick={() => setOwnerTab('CREATORS')}>Creators ({creators.length}/15)</button>
                  <button className={`nav-tab ${ownerTab === 'CUSTOMERS' ? 'active' : ''}`} onClick={() => setOwnerTab('CUSTOMERS')}>Customers ({customers.length})</button>
                  <button className={`nav-tab ${ownerTab === 'CATALOGUE' ? 'active' : ''}`} onClick={() => setOwnerTab('CATALOGUE')}>Catalogue & Tax</button>
                  <button className={`nav-tab ${ownerTab === 'PAYMENTS' ? 'active' : ''}`} onClick={() => setOwnerTab('PAYMENTS')}>Payments & Credits</button>
                  <button className={`nav-tab ${ownerTab === 'PROFILE' ? 'active' : ''}`} onClick={() => setOwnerTab('PROFILE')}>Onboarding & Profile</button>
                </div>

                {/* Dashboard Tab */}
                {ownerTab === 'DASHBOARD' && dashboardData && (
                  <div>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="label">Monthly Quota</div>
                        <div className="value">{dashboardData.monthly_quota?.remaining ?? 10} / {dashboardData.monthly_quota?.limit ?? 10}</div>
                        <div className="meta">{dashboardData.monthly_quota?.used ?? 0} issued this month</div>
                      </div>
                      <div className="stat-card">
                        <div className="label">Total Invoiced</div>
                        <div className="value">₹{dashboardData.invoiced_total?.toLocaleString() ?? 0}</div>
                        <div className="meta">Across all issued invoices</div>
                      </div>
                      <div className="stat-card">
                        <div className="label">Total Collected</div>
                        <div className="value" style={{ color: '#2e6930' }}>₹{dashboardData.collected_total?.toLocaleString() ?? 0}</div>
                        <div className="meta">Confirmed payments</div>
                      </div>
                      <div className="stat-card">
                        <div className="label">Outstanding</div>
                        <div className="value" style={{ color: '#8c4031' }}>₹{dashboardData.outstanding_total?.toLocaleString() ?? 0}</div>
                        <div className="meta">₹{dashboardData.overdue_total?.toLocaleString() ?? 0} overdue</div>
                      </div>
                      <div className="stat-card">
                        <div className="label">Pending Review</div>
                        <div className="value">{dashboardData.approvals_count ?? 0}</div>
                        <div className="meta">Submitted by creators</div>
                      </div>
                    </div>

                    <div className="card">
                      <h3>Recent Invoices</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Customer</th>
                            <th>Date</th>
                            <th>Status</th>
                            <th>Total</th>
                            <th>Outstanding</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.slice(0, 5).map(inv => (
                            <tr key={inv.id}>
                              <td><strong>{inv.invoice_number ?? 'DRAFT'}</strong></td>
                              <td>{inv.customer_name}</td>
                              <td>{inv.invoice_date}</td>
                              <td>
                                <span className={`badge ${inv.document_state === 'ISSUED' ? 'issued' : inv.approval_state.toLowerCase()}`}>
                                  {inv.document_state === 'ISSUED' ? 'ISSUED' : inv.approval_state}
                                </span>
                              </td>
                              <td>₹{inv.total}</td>
                              <td>₹{inv.outstanding_amount}</td>
                              <td>
                                <button className="btn secondary sm" onClick={() => setSelectedInvoice(inv)}>View</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Invoices Tab */}
                {ownerTab === 'INVOICES' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div><h3 style={{marginBottom:4}}>All Invoices</h3><p style={{margin:0,fontSize:13,color:'var(--muted)'}}>Issue your own drafts directly. Creator invoices become available for approval after submission.</p></div>
                      <button className="btn primary sm" onClick={() => setShowInvoiceModal(true)}>+ Prepare Invoice</button>
                    </div>

                    <div className="card">
                      <table>
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Customer</th>
                            <th>Origin</th>
                            <th>Status</th>
                            <th>Total</th>
                            <th>Outstanding</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map(inv => (
                            <tr key={inv.id}>
                              <td><strong>{inv.invoice_number ?? 'UNISSUED DRAFT'}</strong></td>
                              <td>{inv.customer_name} ({inv.customer_email})</td>
                              <td>{inv.origin}</td>
                              <td>
                                <span className={`badge ${inv.document_state === 'ISSUED' ? 'issued' : inv.approval_state.toLowerCase()}`}>
                                  {inv.document_state === 'ISSUED' ? 'ISSUED' : inv.approval_state}
                                </span>
                              </td>
                              <td>₹{inv.total}</td>
                              <td>₹{inv.outstanding_amount}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="btn secondary sm" onClick={() => setSelectedInvoice(inv)}>Details</button>
                                  {canIssueInvoice(inv) && (
                                    <button className="btn primary sm" onClick={() => void act(async () => {
                                      await api(`/invoices/${inv.id}/approve-and-issue`, { version: inv.version });
                                      setNotice(inv.origin==='CREATOR'?'Invoice approved and issued!':'Invoice issued successfully!');
                                      loadWorkspace(actor);
                                    })}>{inv.origin==='CREATOR'?'Approve & Issue':'Issue Invoice'}</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {invoices.length === 0 && (
                            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No invoices found. Prepare a new invoice to get started.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Creators Tab */}
                {ownerTab === 'CREATORS' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div>
                        <h3>Team Creators</h3>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Manage up to 5 active and 15 existing creators.</p>
                      </div>
                      <button className="btn primary sm" onClick={() => setShowCreatorModal(true)} disabled={creators.length >= 15}>+ Add Creator</button>
                    </div>

                    <div className="card">
                      <table>
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>Status</th>
                            <th>Added</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creators.map(c => (
                            <tr key={c.id}>
                              <td><strong>{c.email}</strong></td>
                              <td><span className={`badge ${c.status.toLowerCase()}`}>{c.status}</span></td>
                              <td>{new Date(c.created_at).toLocaleDateString()}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  {c.status === 'ACTIVE' ? (
                                    <button className="btn secondary sm" onClick={() => void act(async () => {
                                      await api(`/vendor/creators/${c.id}/freeze`, { version: c.version });
                                      setNotice('Creator frozen.');
                                      loadWorkspace(actor);
                                    })}>Freeze</button>
                                  ) : (
                                    <button className="btn secondary sm" onClick={() => void act(async () => {
                                      await api(`/vendor/creators/${c.id}/unfreeze`, { version: c.version });
                                      setNotice('Creator unfrozen.');
                                      loadWorkspace(actor);
                                    })}>Unfreeze</button>
                                  )}
                                  <button className="btn danger sm" onClick={() => void act(async () => {
                                    if (confirm('Are you sure you want to remove this creator?')) {
                                      await api(`/vendor/creators/${c.id}`, {}, 'DELETE');
                                      setNotice('Creator removed.');
                                      loadWorkspace(actor);
                                    }
                                  })}>Remove</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {creators.length === 0 && (
                            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No creators added yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Customers Tab */}
                {ownerTab === 'CUSTOMERS' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3>Customer Directory</h3>
                      <button className="btn primary sm" onClick={() => setShowCustomerModal(true)}>+ Add Customer</button>
                    </div>

                    <div className="card">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Status</th>
                            <th>GSTIN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.map(c => (
                            <tr key={c.id}>
                              <td><strong>{c.name}</strong></td>
                              <td>{c.email}</td>
                              <td>{c.phone ?? '—'}</td>
                              <td><span className={`badge ${c.status.toLowerCase()}`}>{c.status}</span></td>
                              <td>{c.gstin ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Catalogue Tab */}
                {ownerTab === 'CATALOGUE' && (
                  <div className="grid-2">
                    <div className="card">
                      <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}><h3 style={{margin:0}}>Products &amp; Services</h3><button className="btn primary sm" onClick={()=>{setError('');setCatalogueForm(emptyCatalogueForm);setShowCatalogueModal(true);}}>+ Add Product / Service</button></div>
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Unit</th>
                            <th>Price</th>
                            <th>Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catalogueItems.map(item => (
                            <tr key={item.id}>
                              <td><strong>{item.name}</strong></td>
                              <td>{item.item_type==='SERVICE'?'Service':'Product'}</td>
                              <td>{item.unit}</td>
                              <td>₹{item.unit_price}</td>
                              <td>{item.tax_profile_name ?? 'None'}</td>
                            </tr>
                          ))}
                          {catalogueItems.length===0&&<tr><td colSpan={5} style={{color:'var(--muted)',textAlign:'center',padding:24}}>No products or services yet. Add your first item to prepare an invoice.</td></tr>}
                        </tbody>
                      </table>
                    </div>

                    <div className="card">
                      <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}><h3 style={{margin:0}}>Tax Profiles (GST)</h3><button className="btn primary sm" onClick={()=>{setError('');setTaxForm({name:'',mode:'GST',components:[{name:'',rate:''}]});setShowTaxModal(true);}}>+ Add Tax Profile</button></div>
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Mode</th>
                            <th>Rates</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taxProfiles.map(tp => (
                            <tr key={tp.id}>
                              <td><strong>{tp.name}</strong></td>
                              <td>{tp.mode}</td>
                              <td>{tp.mode==='NONE'?'No tax':tp.components?.map((c: any) => `${c.name}: ${c.rate}%`).join(', ')}</td>
                            </tr>
                          ))}
                          {taxProfiles.length===0&&<tr><td colSpan={3} style={{color:'var(--muted)',textAlign:'center',padding:24}}>No tax profiles yet. Add one if your items require tax.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Payments Tab */}
                {ownerTab === 'PAYMENTS' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3>Payments & Receipts</h3>
                    </div>

                    <div className="card">
                      <table>
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Source</th>
                            <th>Received At</th>
                            <th>Remaining Funds</th>
                            <th>Credit Available</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map(p => (
                            <tr key={p.id}>
                              <td><strong>{p.customer_name}</strong></td>
                              <td>₹{p.amount}</td>
                              <td>{p.method}</td>
                              <td><span className="badge issued">{p.source}</span></td>
                              <td>{new Date(p.received_at).toLocaleString()}</td>
                              <td>₹{p.remaining_funds}</td>
                              <td>₹{p.available_credit}</td>
                            </tr>
                          ))}
                          {payments.length === 0 && (
                            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No payments recorded yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Profile Tab */}
                {ownerTab === 'PROFILE' && (
                  <div className="card" style={{ maxWidth: 600 }}>
                    <h3>Business Onboarding & Profile</h3>
                    {vendorInfo?.status==='DRAFT'&&<p>Your account is registered. Complete this profile and submit it to request platform approval.</p>}
                    {vendorInfo?.status==='SUBMITTED'&&<p>Your business application has been submitted and is awaiting platform review.</p>}
                    {vendorInfo?.onboarding_review?.reason&&['MORE_INFO','REJECTED'].includes(vendorInfo.status)&&<div className="message error"><strong>{vendorInfo.status==='MORE_INFO'?'Information requested: ':'Review reason: '}</strong>{vendorInfo.onboarding_review.reason}</div>}

                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                      Current Vendor Status: <span className={`badge ${vendorInfo?.status?.toLowerCase()}`}>{vendorInfo?.status}</span>
                    </p>

                    <form onSubmit={e => {
                      e.preventDefault();
                      void act(async () => {
                        const target = e.target as any;
                        const body = {
                          business_name: target.bName.value,
                          contact_email: target.bEmail.value,
                          contact_mobile: target.bPhone.value,
                          gstin: target.bGstin.value,
                          address: { line1: target.bLine1.value, city: target.bCity.value, state_code: target.bState.value, postal_code: target.bPostal.value, country_code: 'IN' },
                          version: vendorInfo?.version ?? 1,
                        };
                        const saved = await api('/vendor/onboarding', body, 'PATCH');
                        await api('/vendor/onboarding/submit', { version: saved.version });
                        setNotice('Profile updated and submitted for platform review!');
                        loadWorkspace(actor);
                      });
                    }}>
                      <label>Business Name</label>
                      <input name="bName" defaultValue={profile?.business_name ?? ''} required />

                      <label>Contact Email</label>
                      <input name="bEmail" type="email" defaultValue={profile?.contact_email ?? actor.email} required />

                      <label>Mobile</label>
                      <input name="bPhone" defaultValue={profile?.contact_mobile ?? ''} />

                      <label>GSTIN</label>
                      <input name="bGstin" defaultValue={profile?.gstin ?? ''} />

                      <label>Address Line 1</label>
                      <input name="bLine1" defaultValue={profile?.address?.line1 ?? ''} required />

                      <div className="grid-3">
                        <div><label>City</label><input name="bCity" defaultValue={profile?.address?.city ?? ''} required /></div>
                        <div><label>State Code</label><input name="bState" defaultValue={profile?.address?.state_code ?? 'DL'} required /></div>
                        <div><label>Postal Code</label><input name="bPostal" defaultValue={profile?.address?.postal_code ?? ''} required /></div>
                      </div>

                      <button className="btn primary" style={{ marginTop: 24 }} type="submit" disabled={busy}>Save & Submit for Review</button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* CREATOR WORKSPACE */}
            {actor.role === 'CREATOR' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3>Creator Invoice Workbench</h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Select customer and catalogue items, enter quantities, and submit for Owner approval.</p>
                  </div>
                  <button className="btn primary sm" onClick={() => setShowInvoiceModal(true)}>+ Prepare Invoice</button>
                </div>

                <div className="card">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => (
                        <tr key={inv.id}>
                          <td><strong>{inv.invoice_number ?? 'DRAFT'}</strong></td>
                          <td>{inv.customer_name}</td>
                          <td><span className={`badge ${inv.approval_state.toLowerCase()}`}>{inv.approval_state}</span></td>
                          <td>₹{inv.total}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {['DRAFT', 'REWORK'].includes(inv.approval_state) && (
                                <button className="btn primary sm" onClick={() => void act(async () => {
                                  await api(`/invoices/${inv.id}/submit`, { version: inv.version });
                                  setNotice('Invoice submitted to Vendor Owner for review!');
                                  loadWorkspace(actor);
                                })}>Submit for review</button>
                              )}
                              <button className="btn secondary sm" onClick={() => setSelectedInvoice(inv)}>View</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {invoices.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No drafts or submissions. Prepare a new invoice draft.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PLATFORM OWNER WORKSPACE */}
            {actor.role === 'PLATFORM_OWNER' && (
              <div>
                <div className="nav-bar">
                  <button className={`nav-tab ${adminTab === 'DASHBOARD' ? 'active' : ''}`} onClick={() => setAdminTab('DASHBOARD')}>Admin Dashboard</button>
                  <button className={`nav-tab ${adminTab === 'VENDORS' ? 'active' : ''}`} onClick={() => setAdminTab('VENDORS')}>Vendors ({adminVendors.length})</button>
                  <button className={`nav-tab ${adminTab === 'CHANGE_REQUESTS' ? 'active' : ''}`} onClick={() => setAdminTab('CHANGE_REQUESTS')}>Pending Reviews ({adminRequests.length})</button>
                  <button className={`nav-tab ${adminTab === 'JOBS' ? 'active' : ''}`} onClick={() => setAdminTab('JOBS')}>Job Monitoring ({adminJobs.length})</button>
                  <button className={`nav-tab ${adminTab === 'INTEGRATIONS' ? 'active' : ''}`} onClick={()=>setAdminTab('INTEGRATIONS')}>Payment & Email Settings</button>
                  <button className="btn secondary sm" disabled={busy} onClick={()=>void act(async()=>{await loadWorkspace(actor);})}>Refresh</button>
                </div>

                {adminTab === 'DASHBOARD' && dashboardData && (
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="label">Total Vendors</div>
                      <div className="value">{adminVendors.length}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Pending Reviews</div>
                      <div className="value" style={{ color: '#8c4031' }}>{dashboardData.pending_changes ?? 0}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Failed Jobs</div>
                      <div className="value">{dashboardData.failed_jobs ?? 0}</div>
                    </div>
                  </div>
                )}

                {adminTab === 'VENDORS' && (
                  <div className="card">
                    <h3>All Vendors</h3>
                    <p style={{fontSize:13,color:'var(--muted)'}}>Registration email identifies the account owner. Business applications become reviewable after the vendor submits their onboarding profile.</p>
                    <div style={{overflowX:'auto'}}><table>
                      <thead><tr><th>Business / Account</th><th>Registration Email</th><th>Business Contact Email</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                      <tbody>
                        {adminVendors.map(v => (
                          <tr key={v.id}>
                            <td><strong>{v.business_name??'Business profile not completed'}</strong><div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{v.id}</div></td>
                            <td>{v.owner_email??'Owner record unavailable'}<div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{v.owner_email_verified_at?'Email verified':'Email not verified'}</div></td>
                            <td>{v.contact_email??'Not provided'}</td>
                            <td><span className={`badge ${v.status.toLowerCase()}`}>{v.status}</span>{v.status==='DRAFT'&&<div style={{fontSize:12,marginTop:6}}>Awaiting vendor submission</div>}</td>
                            <td>{new Date(v.created_at).toLocaleDateString()}</td>
                            <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button className="btn secondary sm" disabled={busy} onClick={()=>void openVendorReview(v.id)}>View details</button>
                              {v.onboarding_request_id&&v.status==='SUBMITTED'&&<>
                                <button className="btn primary sm" disabled={busy} onClick={()=>void openVendorReview(v.id,v.onboarding_request_id,'APPROVE')}>Approve</button>
                                <button className="btn danger sm" disabled={busy} onClick={()=>void openVendorReview(v.id,v.onboarding_request_id,'REJECT')}>Reject</button>
                                <button className="btn secondary sm" disabled={busy} onClick={()=>void openVendorReview(v.id,v.onboarding_request_id,'MORE_INFO')}>Request more information</button>
                              </>}
                              {v.status!=='BLOCKED'?<button className="btn danger sm" disabled={busy} onClick={()=>void act(async()=>{
                                await api(`/admin/vendors/${v.id}/block`,{version:v.version,reason:'Platform administration block'});setNotice('Vendor blocked.');await loadWorkspace(actor);
                              })}>Block</button>:<button className="btn secondary sm" disabled={busy} onClick={()=>void act(async()=>{
                                await api(`/admin/vendors/${v.id}/restore`,{version:v.version});setNotice('Vendor restored.');await loadWorkspace(actor);
                              })}>Restore</button>}
                            </div></td>
                          </tr>
                        ))}
                        {adminVendors.length===0&&<tr><td colSpan={6}>No vendors found.</td></tr>}
                      </tbody>
                    </table></div>
                  </div>
                )}

                {adminTab === 'CHANGE_REQUESTS' && (
                  <div className="card">
                    <h3>Pending Reviews</h3>
                    <div style={{overflowX:'auto'}}><table>
                      <thead><tr><th>Business / Account</th><th>Registration Email</th><th>Proposed Contact Email</th><th>Request</th><th>Submitted</th><th>Actions</th></tr></thead>
                      <tbody>
                        {adminRequests.map(r=>(
                          <tr key={r.id}>
                            <td><strong>{r.business_name??'Business profile not completed'}</strong><div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{r.vendor_id}</div></td>
                            <td>{r.owner_email??'Owner record unavailable'}</td>
                            <td>{r.contact_email??'Not provided'}</td>
                            <td>{r.kind==='ONBOARDING'?'Vendor onboarding':'Profile change'}<div style={{fontSize:11,color:'var(--muted)'}}>{r.target}</div></td>
                            <td>{new Date(r.created_at).toLocaleString()}</td>
                            <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button className="btn secondary sm" disabled={busy} onClick={()=>void openVendorReview(r.vendor_id,r.id)}>View details</button>
                              {r.vendor_status!=='BLOCKED'?<>
                                <button className="btn primary sm" disabled={busy} onClick={()=>void openVendorReview(r.vendor_id,r.id,'APPROVE')}>Approve</button>
                                <button className="btn danger sm" disabled={busy} onClick={()=>void openVendorReview(r.vendor_id,r.id,'REJECT')}>Reject</button>
                                <button className="btn secondary sm" disabled={busy} onClick={()=>void openVendorReview(r.vendor_id,r.id,'MORE_INFO')}>Request more information</button>
                              </>:<span>Restore vendor before reviewing.</span>}
                            </div></td>
                          </tr>
                        ))}
                        {adminRequests.length===0&&<tr><td colSpan={6} style={{textAlign:'center',color:'var(--muted)',padding:24}}>No pending requests.</td></tr>}
                      </tbody>
                    </table></div>
                  </div>
                )}

                {adminTab==='INTEGRATIONS'&&(
                  <div className="card" style={{maxWidth:680}}>
                    <h3>Payment & Email Settings</h3>
                    {!integrations?<p>Settings could not be loaded. Refresh after verifying your email.</p>:<>
                      <p>Payments: {integrations.payment.driver==='razorpay'?'Razorpay Test Mode':'Local simulation'} · {integrations.payment.configured?'Credentials configured':'Setup required'} · Webhook {integrations.payment.webhook_configured?'configured':'setup required'}</p>
                      <label htmlFor="email-provider">Email provider</label>
                      <select id="email-provider" value={emailProvider} onChange={e=>setEmailProvider(e.target.value)}>
                        {integrations.email_options.map((option:any)=><option key={option.value} value={option.value} disabled={!option.configured}>{option.label}{!option.configured?' — setup required':''}</option>)}
                      </select>
                      <p>{integrations.email_options.find((option:any)=>option.value===emailProvider)?.detail}</p>
                      <p>This choice applies to new email jobs across all vendors. Existing retries keep their original provider. AWS SES and Resend send real emails; local preview and the local SES emulator capture messages for development.</p>
                      <button className="btn primary" disabled={busy} onClick={()=>void act(async()=>{
                        const saved=await api('/admin/integrations/email',{provider:emailProvider},'PATCH');setIntegrations(saved);setNotice('Email provider saved.');
                      })}>Save email provider</button>
                    </>}
                  </div>
                )}

                {adminTab === 'JOBS' && (
                  <div className="card">
                    <h3>Outbox Jobs</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Kind</th>
                          <th>Status</th>
                          <th>Attempts</th>
                          <th>Last Error</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminJobs.map(j => (
                          <tr key={j.id}>
                            <td><strong>{j.kind}</strong></td>
                            <td><span className={`badge ${j.status.toLowerCase()}`}>{j.status}</span></td>
                            <td>{j.attempts} / {j.max_attempts}</td>
                            <td>{j.last_error ?? '—'}</td>
                            <td>
                              {j.status === 'DEAD' && (
                                <button className="btn secondary sm" onClick={() => void act(async () => {
                                  await api(`/admin/jobs/${j.id}/retry`, {});
                                  setNotice('Job retried.');
                                  loadWorkspace(actor);
                                })}>Retry</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {actor.role==='PLATFORM_OWNER'&&adminVendorDetails&&(
              <div className="modal-overlay">
                <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="vendor-review-heading">
                  <div className="modal-header"><h3 id="vendor-review-heading">Vendor application details</h3><button className="btn secondary sm" disabled={busy} onClick={()=>setAdminVendorDetails(null)} aria-label="Close vendor details">✕</button></div>
                  {error&&<div className="message error" role="alert">{error}</div>}
                  <dl style={{fontSize:14,lineHeight:1.7}}>
                    <dt><strong>Registration email</strong></dt><dd style={{margin:0}}>{adminVendorDetails.owner?.email??'Owner record unavailable'} · {adminVendorDetails.owner?.email_verified_at?'Verified':'Not verified'}</dd>
                    <dt><strong>Vendor ID</strong></dt><dd style={{margin:0,overflowWrap:'anywhere'}}>{adminVendorDetails.vendor.id}</dd>
                    <dt><strong>Vendor status</strong></dt><dd style={{margin:0}}>{adminVendorDetails.vendor.status}</dd>
                    <dt><strong>Business name</strong></dt><dd style={{margin:0}}>{reviewProfile?.business_name??'Not provided'}</dd>
                    <dt><strong>Business contact email</strong></dt><dd style={{margin:0}}>{reviewProfile?.contact_email??'Not provided'}</dd>
                    <dt><strong>Mobile</strong></dt><dd style={{margin:0}}>{reviewProfile?.contact_mobile||'Not provided'}</dd>
                    <dt><strong>GSTIN</strong></dt><dd style={{margin:0}}>{reviewProfile?.gstin||'Not provided'}</dd>
                    <dt><strong>Address</strong></dt><dd style={{margin:0}}>{reviewProfile?.address?Object.values(reviewProfile.address).filter(Boolean).join(', '):'Not provided'}</dd>
                  </dl>
                  {adminVendorDetails.vendor.status==='DRAFT'&&<p>The account is registered. The vendor must complete Onboarding &amp; Profile and click Save &amp; Submit for Review before you can approve, reject or request changes.</p>}
                  {selectedAdminRequest&&selectedAdminRequest.status==='SUBMITTED'&&adminVendorDetails.vendor.status!=='BLOCKED'?<form onSubmit={e=>{
                    e.preventDefault();void act(async()=>{
                      await api(`/admin/change-requests/${selectedAdminRequest.id}/review`,{version:selectedAdminRequest.version,decision:reviewDecision,...(reviewReason.trim()?{reason:reviewReason.trim()}:{})});
                      setAdminVendorDetails(null);setNotice(reviewDecision==='APPROVE'?'Request approved.':reviewDecision==='REJECT'?'Request rejected.':'More information requested.');await loadWorkspace(actor);
                    });
                  }}>
                    <p>Request: {selectedAdminRequest.kind==='ONBOARDING'?'Vendor onboarding':selectedAdminRequest.target}</p>
                    {selectedAdminRequest.target==='CONTACT_EMAIL'&&!selectedAdminRequest.email_verified_at&&<p>The vendor must verify the proposed email before approval.</p>}
                    <label htmlFor="vendor-review-decision">Review decision</label>
                    <select id="vendor-review-decision" value={reviewDecision} onChange={e=>setReviewDecision(e.target.value as 'APPROVE'|'REJECT'|'MORE_INFO')}>
                      <option value="APPROVE">Approve</option><option value="REJECT">Reject</option><option value="MORE_INFO">Request more information</option>
                    </select>
                    <label htmlFor="vendor-review-reason">{reviewDecision==='APPROVE'?'Review note (optional)':'Reason / information needed'}</label>
                    <textarea id="vendor-review-reason" rows={3} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} required={reviewDecision!=='APPROVE'} placeholder={reviewDecision==='APPROVE'?'Optional review note':'Explain what the vendor needs to correct or provide.'}/>
                    <div className="actions-row"><button type="submit" className={`btn ${reviewDecision==='REJECT'?'danger':'primary'}`} disabled={busy||(reviewDecision!=='APPROVE'&&!reviewReason.trim())||(reviewDecision==='APPROVE'&&selectedAdminRequest.target==='CONTACT_EMAIL'&&!selectedAdminRequest.email_verified_at)}>{reviewDecision==='APPROVE'?'Approve request':reviewDecision==='REJECT'?'Reject request':'Send information request'}</button></div>
                  </form>:adminVendorDetails.vendor.status!=='DRAFT'&&<p>{adminVendorDetails.vendor.status==='BLOCKED'?'Restore this vendor before reviewing its application.':'There is no submitted request awaiting a decision.'}</p>}
                  {adminVendorDetails.change_requests?.some((request:any)=>request.status!=='SUBMITTED')&&<div style={{marginTop:20}}><h4>Review history</h4>{adminVendorDetails.change_requests.filter((request:any)=>request.status!=='SUBMITTED').map((request:any)=><p key={request.id}><strong>{request.status}</strong>{request.reason?` — ${request.reason}`:''}</p>)}</div>}
                </div>
              </div>
            )}

            {actor.role==='OWNER'&&showCatalogueModal&&(
              <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="catalogue-create-heading">
                <div className="modal-header"><h3 id="catalogue-create-heading">Add Product / Service</h3><button type="button" className="btn secondary sm" disabled={busy} onClick={()=>setShowCatalogueModal(false)} aria-label="Close product form">✕</button></div>
                {error&&<div className="message error" role="alert">{error}</div>}
                <form onSubmit={e=>{e.preventDefault();void act(async()=>{
                  if(!catalogueForm.name.trim()||!catalogueForm.unit.trim())throw new Error('Enter a name and unit.');
                  const price=Number(catalogueForm.unit_price);if(catalogueForm.unit_price===''||!Number.isFinite(price)||price<0)throw new Error('Enter a valid non-negative unit price.');
                  await api('/catalogue-items',{name:catalogueForm.name.trim(),item_type:catalogueForm.item_type,unit:catalogueForm.unit.trim(),unit_price:price,
                    ...(catalogueForm.sku.trim()?{sku:catalogueForm.sku.trim()}:{}),...(catalogueForm.hsn_sac.trim()?{hsn_sac:catalogueForm.hsn_sac.trim()}:{}),...(catalogueForm.tax_profile_id?{tax_profile_id:catalogueForm.tax_profile_id}:{})});
                  setShowCatalogueModal(false);setNotice(catalogueForm.item_type==='PRODUCT'?'Product added successfully.':'Service added successfully.');await loadWorkspace(actor);
                });}}>
                  <label htmlFor="catalogue-type">Type</label><select id="catalogue-type" value={catalogueForm.item_type} onChange={e=>setCatalogueForm({...catalogueForm,item_type:e.target.value as 'PRODUCT'|'SERVICE',unit:e.target.value==='SERVICE'?'hour':'piece'})}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option></select>
                  <label htmlFor="catalogue-name">Name</label><input id="catalogue-name" value={catalogueForm.name} onChange={e=>setCatalogueForm({...catalogueForm,name:e.target.value})} maxLength={200} required placeholder="e.g. Office chair or Consulting"/>
                  <div className="grid-2">
                    <div><label htmlFor="catalogue-unit">Unit</label><input id="catalogue-unit" value={catalogueForm.unit} onChange={e=>setCatalogueForm({...catalogueForm,unit:e.target.value})} maxLength={50} required placeholder="piece, kg, hour"/></div>
                    <div><label htmlFor="catalogue-price">Unit price (₹)</label><input id="catalogue-price" type="number" min="0" step="0.01" value={catalogueForm.unit_price} onChange={e=>setCatalogueForm({...catalogueForm,unit_price:e.target.value})} required/></div>
                  </div>
                  <label htmlFor="catalogue-sku">SKU / internal code (optional)</label><input id="catalogue-sku" value={catalogueForm.sku} onChange={e=>setCatalogueForm({...catalogueForm,sku:e.target.value})} maxLength={100}/>
                  <label htmlFor="catalogue-hsn">HSN / SAC (optional)</label><input id="catalogue-hsn" value={catalogueForm.hsn_sac} onChange={e=>setCatalogueForm({...catalogueForm,hsn_sac:e.target.value})} maxLength={20}/>
                  <label htmlFor="catalogue-tax">Tax profile</label><select id="catalogue-tax" value={catalogueForm.tax_profile_id} onChange={e=>setCatalogueForm({...catalogueForm,tax_profile_id:e.target.value})}><option value="">No tax profile</option>{taxProfiles.filter(t=>t.active!==false).map(t=><option key={t.id} value={t.id}>{t.name}{t.mode==='GST'?` (${t.components?.map((c:any)=>`${c.name} ${c.rate}%`).join(' + ')})`:' (No tax)'}</option>)}</select>
                  {taxProfiles.filter(t=>t.active!==false).length===0&&<p style={{fontSize:12,color:'var(--muted)'}}>You can add a tax profile from Catalogue &amp; Tax before creating a taxed item.</p>}
                  <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy?'Saving…':'Save Product / Service'}</button><button type="button" className="btn secondary" disabled={busy} onClick={()=>setShowCatalogueModal(false)}>Cancel</button></div>
                </form>
              </div></div>
            )}

            {actor.role==='OWNER'&&showTaxModal&&(
              <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="tax-create-heading">
                <div className="modal-header"><h3 id="tax-create-heading">Add Tax Profile</h3><button type="button" className="btn secondary sm" disabled={busy} onClick={()=>setShowTaxModal(false)} aria-label="Close tax profile form">✕</button></div>
                {error&&<div className="message error" role="alert">{error}</div>}
                <form onSubmit={e=>{e.preventDefault();void act(async()=>{
                  if(!taxForm.name.trim())throw new Error('Enter a tax profile name.');
                  const components=taxForm.mode==='NONE'?[]:taxForm.components.map(component=>{
                    const rate=Number(component.rate);if(!component.name.trim()||component.rate===''||!Number.isFinite(rate)||rate<0||rate>100)throw new Error('Each tax component needs a name and a rate between 0 and 100.');
                    return {name:component.name.trim(),rate};
                  });
                  if(taxForm.mode==='GST'&&components.length===0)throw new Error('Add at least one tax component.');
                  await api('/tax-profiles',{name:taxForm.name.trim(),mode:taxForm.mode,components});setShowTaxModal(false);setNotice('Tax profile added successfully.');await loadWorkspace(actor);
                });}}>
                  <label htmlFor="tax-name">Profile name</label><input id="tax-name" value={taxForm.name} onChange={e=>setTaxForm({...taxForm,name:e.target.value})} required placeholder="e.g. GST 18%"/>
                  <label htmlFor="tax-mode">Tax mode</label><select id="tax-mode" value={taxForm.mode} onChange={e=>setTaxForm({...taxForm,mode:e.target.value as 'GST'|'NONE'})}><option value="GST">GST</option><option value="NONE">No tax</option></select>
                  {taxForm.mode==='GST'&&<>
                    <p style={{fontSize:13,color:'var(--muted)'}}>Enter the tax components and rates applicable to this profile.</p>
                    {taxForm.components.map((component,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'1fr 100px auto',gap:8,alignItems:'end'}}>
                      <div><label htmlFor={`tax-component-${index}`}>Component name</label><input id={`tax-component-${index}`} value={component.name} required onChange={e=>setTaxForm({...taxForm,components:taxForm.components.map((c,i)=>i===index?{...c,name:e.target.value}:c)})}/></div>
                      <div><label htmlFor={`tax-rate-${index}`}>Rate (%)</label><input id={`tax-rate-${index}`} type="number" min="0" max="100" step="0.01" value={component.rate} required onChange={e=>setTaxForm({...taxForm,components:taxForm.components.map((c,i)=>i===index?{...c,rate:e.target.value}:c)})}/></div>
                      <button type="button" className="btn secondary sm" onClick={()=>setTaxForm({...taxForm,components:taxForm.components.filter((_,i)=>i!==index)})} aria-label={`Remove tax component ${index+1}`}>Remove</button>
                    </div>)}
                    <button type="button" className="btn secondary sm" style={{marginTop:12}} onClick={()=>setTaxForm({...taxForm,components:[...taxForm.components,{name:'',rate:''}]})}>+ Add component</button>
                  </>}
                  <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy?'Saving…':'Save Tax Profile'}</button><button type="button" className="btn secondary" disabled={busy} onClick={()=>setShowTaxModal(false)}>Cancel</button></div>
                </form>
              </div></div>
            )}

            {/* INVOICE PREPARATION MODAL */}
            {showInvoiceModal && (
              <div className="modal-overlay">
                <div className="modal-box">
                  <div className="modal-header">
                    <h3>Prepare Invoice</h3>
                    <button className="btn secondary sm" onClick={() => setShowInvoiceModal(false)}>✕</button>
                  </div>

                  <form onSubmit={e => {
                    e.preventDefault();
                    void act(async () => {
                      const payload = invoiceDraftPayload();
                      await api('/invoices', payload);
                      setShowInvoiceModal(false);
                      setInvCertificateName('');setInvCertificateCourse('');setInvCourseCertificate(false);setInvTemplate('STANDARD');
                      setInvCustomer('');setInvDueDate('');setInvLines([{catalogue_item_id:'',quantity:1}]);
                      setInvOrderReference('');setInvPlaceOfSupply('');setInvShippingAddress('');setInvServiceStart('');setInvServiceEnd('');setInvNotes('');
                      setInvCertificateInstructor('');setInvCertificateType('COURSE');setInvCertificateStyle('NAMASTEDEV');
                      setNotice('Invoice draft created successfully!');
                      loadWorkspace(actor);
                    });
                  }}>
                    {error&&<div className="message error" role="alert">{error}</div>}
                    <label htmlFor="invoice-customer">Select Customer</label>
                    <select id="invoice-customer" value={invCustomer} onChange={e => setInvCustomer(e.target.value)} required>
                      <option value="">-- Choose Customer --</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
                    </select>

                    <label>Due Date</label>
                    <input type="date" value={invDueDate} onChange={e => setInvDueDate(e.target.value)} />

                    <label htmlFor="invoice-layout">Invoice layout</label>
                    <select id="invoice-layout" value={invTemplate} onChange={e=>{
                      const template=e.target.value as 'STANDARD'|'COURSE'|'UDEMY'|'SERVICE';setInvTemplate(template);
                      if(template==='COURSE'||template==='UDEMY'){setInvCourseCertificate(true);setInvCertificateStyle(template==='UDEMY'?'UDEMY':'NAMASTEDEV');}
                    }}>
                      <option value="STANDARD">Retail / books — classic tax invoice</option>
                      <option value="COURSE">NamasteDev-style course invoice — dark</option>
                      <option value="UDEMY">Udemy-style course tax invoice — light</option>
                      <option value="SERVICE">Service / telecom tax invoice</option>
                    </select>
                    <label htmlFor="invoice-order-reference">Order reference (optional)</label><input id="invoice-order-reference" value={invOrderReference} onChange={e=>setInvOrderReference(e.target.value)} maxLength={120}/>
                    <label htmlFor="invoice-place-of-supply">Place of supply (optional)</label><input id="invoice-place-of-supply" value={invPlaceOfSupply} onChange={e=>setInvPlaceOfSupply(e.target.value)} maxLength={120} placeholder="e.g. Delhi, DL"/>
                    {invTemplate==='STANDARD'&&<><label htmlFor="invoice-shipping-address">Shipping address (optional)</label><textarea id="invoice-shipping-address" value={invShippingAddress} onChange={e=>setInvShippingAddress(e.target.value)} maxLength={1000} rows={2}/></>}
                    {invTemplate==='SERVICE'&&<div className="grid-2"><div><label htmlFor="invoice-service-start">Service start date</label><input id="invoice-service-start" type="date" value={invServiceStart} onChange={e=>setInvServiceStart(e.target.value)}/></div><div><label htmlFor="invoice-service-end">Service end date</label><input id="invoice-service-end" type="date" value={invServiceEnd} onChange={e=>setInvServiceEnd(e.target.value)}/></div></div>}
                    <div style={{marginTop:18,padding:14,background:'var(--paper)',border:'1px solid var(--border)',borderRadius:6}}>
                      <label htmlFor="invoice-course-certificate" style={{display:'flex',alignItems:'center',gap:8,margin:0}}><input id="invoice-course-certificate" type="checkbox" checked={invCourseCertificate} onChange={e=>setInvCourseCertificate(e.target.checked)} style={{width:'auto'}}/>Generate a course certificate with this invoice</label>
                      {invCourseCertificate&&<>
                        <p style={{fontSize:12,color:'var(--muted)'}}>The invoice and certificate are generated together when the Vendor Owner issues the invoice.</p>
                        <label htmlFor="invoice-certificate-style">Certificate style</label><select id="invoice-certificate-style" value={invCertificateStyle} onChange={e=>setInvCertificateStyle(e.target.value as 'NAMASTEDEV'|'UDEMY')}><option value="NAMASTEDEV">NamasteDev style — navy and gold</option><option value="UDEMY">Udemy style — clean and light</option></select>
                        <label htmlFor="invoice-certificate-name">Learner name</label><input id="invoice-certificate-name" value={invCertificateName} onChange={e=>setInvCertificateName(e.target.value)} maxLength={200} placeholder={customers.find(c=>c.id===invCustomer)?.name??'Defaults to the selected customer'}/>
                        <label htmlFor="invoice-certificate-course">Course title</label><input id="invoice-certificate-course" value={invCertificateCourse} onChange={e=>setInvCertificateCourse(e.target.value)} maxLength={200} placeholder="Defaults to the selected course / item names"/>
                        <label htmlFor="invoice-certificate-kind">Certificate wording</label><select id="invoice-certificate-kind" value={invCertificateType} onChange={e=>setInvCertificateType(e.target.value as 'COURSE'|'COMPLETION')}><option value="COURSE">Course participation</option><option value="COMPLETION">Course completion</option></select>
                        {invCertificateType==='COMPLETION'&&<p style={{fontSize:12,color:'var(--muted)'}}>Select completion only when the issuer confirms that the learner has completed the course.</p>}
                        <label htmlFor="invoice-certificate-date">Certificate date</label><input id="invoice-certificate-date" type="date" value={invCertificateDate} required onChange={e=>setInvCertificateDate(e.target.value)}/>
                        <label htmlFor="invoice-certificate-instructor">Instructor / signatory name (optional)</label><input id="invoice-certificate-instructor" value={invCertificateInstructor} onChange={e=>setInvCertificateInstructor(e.target.value)} maxLength={120}/>
                      </>}
                    </div>
                    <label htmlFor="invoice-notes">Invoice notes (optional)</label><textarea id="invoice-notes" value={invNotes} onChange={e=>setInvNotes(e.target.value)} rows={2} maxLength={2000}/>
                    <div className="actions-row"><button type="button" className="btn secondary sm" disabled={busy} onClick={()=>void previewInvoiceDocument('invoice')}>Preview invoice PDF</button>{invCourseCertificate&&<button type="button" className="btn secondary sm" disabled={busy} onClick={()=>void previewInvoiceDocument('certificate')}>Preview certificate PDF</button>}</div>
                    {invoicePreviewUrl&&<div style={{marginTop:14}}><p style={{fontSize:12,color:'var(--muted)'}}>Preview snapshot — refresh the preview after changing details.</p><iframe title="Invoice or certificate PDF preview" src={invoicePreviewUrl} style={{width:'100%',height:400,border:'1px solid var(--border)'}}/></div>}

                    <label>Items / Services</label>
                    {invLines.map((line, idx) => (
                      <div key={idx} style={{marginBottom:12}}><div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 40px', gap: 8 }}>
                        <select aria-label={`Invoice item ${idx+1}`} value={line.catalogue_item_id} onChange={e => {
                          const updated = [...invLines];
                          updated[idx] = {catalogue_item_id:e.target.value,quantity:line.quantity};
                          setInvLines(updated);
                        }} required>
                          <option value="">-- Select Item --</option>
                          {catalogueItems.map(item => <option key={item.id} value={item.id}>{item.name} (₹{item.unit_price}/{item.unit})</option>)}
                        </select>
                        <input aria-label={`Quantity for item ${idx+1}`} type="number" min={0.000001} step="any" value={line.quantity} onChange={e => {
                          const updated = [...invLines];
                          updated[idx]!.quantity = Number(e.target.value);
                          setInvLines(updated);
                        }} placeholder="Qty" required />
                        <button type="button" aria-label={`Remove item ${idx+1}`} className="btn danger sm" onClick={() => setInvLines(invLines.filter((_, i) => i !== idx))}>✕</button>
                      </div>
                      {actor.role==='OWNER'&&<div className="grid-2">
                        <div><label htmlFor={`invoice-unit-price-${idx}`}>Unit price override (optional)</label><input id={`invoice-unit-price-${idx}`} type="number" min={0} step="0.01" placeholder={String(catalogueItems.find(item=>item.id===line.catalogue_item_id)?.unit_price??'Catalogue price')} value={line.unit_price??''} onChange={e=>setInvLines(invLines.map((entry,i)=>i===idx?{...entry,unit_price:e.target.value===''?undefined:Number(e.target.value)}:entry))}/></div>
                        <div><label htmlFor={`invoice-discount-${idx}`}>Line discount (INR)</label><input id={`invoice-discount-${idx}`} type="number" min={0} step="0.01" value={line.discount_amount??0} onChange={e=>setInvLines(invLines.map((entry,i)=>i===idx?{...entry,discount_amount:Number(e.target.value)}:entry))}/></div>
                      </div>}
                      </div>
                    ))}
                    <button type="button" className="btn secondary sm" style={{ marginTop: 8 }} onClick={() => setInvLines([...invLines, { catalogue_item_id: '', quantity: 1 }])}>+ Add Line</button>

                    <button className="btn primary" style={{ width: '100%', marginTop: 24 }} type="submit" disabled={busy}>Create Invoice Draft</button>
                  </form>
                </div>
              </div>
            )}

            {/* CREATOR ADD MODAL */}
            {showCreatorModal && (
              <div className="modal-overlay">
                <div className="modal-box">
                  <div className="modal-header">
                    <h3>Add Creator</h3>
                    <button className="btn secondary sm" onClick={() => setShowCreatorModal(false)}>✕</button>
                  </div>
                  <form onSubmit={e => {
                    e.preventDefault();
                    void act(async () => {
                      await api('/vendor/creators', { email: newCreatorEmail, password: newCreatorPassword, status: newCreatorStatus });
                      setShowCreatorModal(false);
                      setNewCreatorEmail('');
                      setNewCreatorPassword('');
                      setNotice('Creator account added successfully!');
                      loadWorkspace(actor);
                    });
                  }}>
                    <label>Creator Email</label>
                    <input type="email" value={newCreatorEmail} onChange={e => setNewCreatorEmail(e.target.value)} required />
                    <label>Initial Password (Min 12 chars)</label>
                    <input type="password" minLength={12} value={newCreatorPassword} onChange={e => setNewCreatorPassword(e.target.value)} required />
                    <label>Status</label>
                    <select value={newCreatorStatus} onChange={e => setNewCreatorStatus(e.target.value as any)}>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="FROZEN">FROZEN</option>
                    </select>
                    <button className="btn primary" style={{ width: '100%', marginTop: 24 }} type="submit" disabled={busy}>Create Account</button>
                  </form>
                </div>
              </div>
            )}

            {/* CUSTOMER ADD MODAL */}
            {showCustomerModal && (
              <div className="modal-overlay">
                <div className="modal-box">
                  <div className="modal-header">
                    <h3>Add Customer</h3>
                    <button className="btn secondary sm" onClick={() => setShowCustomerModal(false)}>✕</button>
                  </div>
                  <form onSubmit={e => {
                    e.preventDefault();
                    void act(async () => {
                      await api('/customers', {
                        name: custName,
                        email: custEmail,
                        phone: custPhone || undefined,
                        address: { line1: custLine1, city: custCity, state_code: custState, postal_code: custPostal, country_code: 'IN' },
                      });
                      setShowCustomerModal(false);
                      setCustName('');
                      setCustEmail('');
                      setNotice('Customer added successfully!');
                      loadWorkspace(actor);
                    });
                  }}>
                    <label>Customer Name</label>
                    <input value={custName} onChange={e => setCustName(e.target.value)} required />
                    <label>Email</label>
                    <input type="email" value={custEmail} onChange={e => setCustEmail(e.target.value)} required />
                    <label>Phone</label>
                    <input value={custPhone} onChange={e => setCustPhone(e.target.value)} />
                    <label>Address Line 1</label>
                    <input value={custLine1} onChange={e => setCustLine1(e.target.value)} required />
                    <div className="grid-3">
                      <div><label>City</label><input value={custCity} onChange={e => setCustCity(e.target.value)} required /></div>
                      <div><label>State Code</label><input value={custState} onChange={e => setCustState(e.target.value)} required /></div>
                      <div><label>Postal Code</label><input value={custPostal} onChange={e => setCustPostal(e.target.value)} required /></div>
                    </div>
                    <button className="btn primary" style={{ width: '100%', marginTop: 24 }} type="submit" disabled={busy}>Save Customer</button>
                  </form>
                </div>
              </div>
            )}

            {/* INVOICE DETAILS MODAL */}
            {selectedInvoice && (
              <div className="modal-overlay">
                <div className="modal-box">
                  <div className="modal-header">
                    <h3>{selectedInvoice.invoice_number ?? 'Invoice Draft'}</h3>
                    <button className="btn secondary sm" onClick={() => setSelectedInvoice(null)}>✕</button>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                    <p><strong>Customer:</strong> {selectedInvoice.customer_name} ({selectedInvoice.customer_email})</p>
                    <p><strong>Date:</strong> {selectedInvoice.invoice_date} {selectedInvoice.due_date && `| Due: ${selectedInvoice.due_date}`}</p>
                    <p><strong>Total:</strong> ₹{selectedInvoice.total} (Subtotal: ₹{selectedInvoice.subtotal}, Tax: ₹{selectedInvoice.tax_total})</p>
                    <p><strong>Outstanding:</strong> ₹{selectedInvoice.outstanding_amount}</p>
                    <p><strong>Layout:</strong> {selectedInvoice.document_options?.template??'STANDARD'}</p>
                    {(selectedInvoice.document_options?.certificates?.length??0)>0&&<p><strong>Course certificates:</strong> {selectedInvoice.document_options.certificates.length} requested with this invoice.</p>}
                  </div>

                  <div className="actions-row">
                    {selectedInvoice.document_state==='ISSUED'&&<a className="btn secondary sm" href={`/api/v1/invoices/${selectedInvoice.id}/document/content`} target="_blank" rel="noreferrer">Download PDF</a>}
                    {actor.role==='OWNER'&&selectedInvoice.document_state==='ISSUED'&&<button className="btn secondary sm" disabled={busy} onClick={()=>void openExistingCertificate(selectedInvoice)}>Create course certificate</button>}
                    {invoiceDocuments.filter(document=>document.kind==='COURSE_CERTIFICATE').map((document,index)=><a key={document.id} className="btn secondary sm" href={`/api/v1/documents/${document.id}/content`} target="_blank" rel="noreferrer">Download certificate {index+1}</a>)}
                    {actor.role === 'OWNER' && canIssueInvoice(selectedInvoice) && (
                      <button className="btn primary sm" onClick={() => void act(async () => {
                        await api(`/invoices/${selectedInvoice.id}/approve-and-issue`, { version: selectedInvoice.version });
                        setNotice(selectedInvoice.origin==='CREATOR'?'Approved and issued!':'Invoice issued successfully!');
                        setSelectedInvoice(null);
                        loadWorkspace(actor);
                      })}>{selectedInvoice.origin==='CREATOR'?'Approve & Issue':'Issue Invoice'}</button>
                    )}
                    {actor.role === 'OWNER' && selectedInvoice.document_state === 'ISSUED' && selectedInvoice.outstanding_amount > 0 && (
                      <button className="btn danger sm" onClick={() => void act(async () => {
                        await api(`/invoices/${selectedInvoice.id}/cancel`, { version: selectedInvoice.version, reason: 'Owner cancellation' });
                        setNotice('Invoice cancelled.');
                        setSelectedInvoice(null);
                        loadWorkspace(actor);
                      })}>Cancel Invoice</button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {actor.role==='OWNER'&&certificateForInvoice&&(
              <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="existing-certificate-heading">
                <div className="modal-header"><h3 id="existing-certificate-heading">Create course certificate</h3><button type="button" className="btn secondary sm" disabled={busy} onClick={()=>setCertificateForInvoice(null)} aria-label="Close certificate form">✕</button></div>
                <p>Related invoice: <strong>{certificateForInvoice.invoice_number}</strong>. This creates a certificate without changing the invoice amount or its financial history.</p>
                {error&&<div className="message error" role="alert">{error}</div>}
                <form onSubmit={e=>{e.preventDefault();void act(async()=>{
                  await api(`/invoices/${certificateForInvoice.id}/certificates`,{request_key:certificateRequestKey,recipient_name:invCertificateName.trim(),course_name:invCertificateCourse.trim(),awarded_on:invCertificateDate,style:invCertificateStyle,certificate_type:invCertificateType,...(invCertificateInstructor.trim()?{instructor_name:invCertificateInstructor.trim()}:{})});
                  const invoice=certificateForInvoice;setCertificateForInvoice(null);setSelectedInvoice(invoice);setNotice('Course certificate queued. Its download will appear with the invoice documents shortly.');
                });}}>
                  <label htmlFor="existing-certificate-style">Certificate style</label><select id="existing-certificate-style" value={invCertificateStyle} onChange={e=>setInvCertificateStyle(e.target.value as 'NAMASTEDEV'|'UDEMY')}><option value="NAMASTEDEV">NamasteDev style — navy and gold</option><option value="UDEMY">Udemy style — clean and light</option></select>
                  <label htmlFor="existing-certificate-name">Learner name</label><input id="existing-certificate-name" required maxLength={200} value={invCertificateName} onChange={e=>setInvCertificateName(e.target.value)}/>
                  <label htmlFor="existing-certificate-course">Course title</label><input id="existing-certificate-course" required maxLength={200} value={invCertificateCourse} onChange={e=>setInvCertificateCourse(e.target.value)}/>
                  <label htmlFor="existing-certificate-kind">Certificate wording</label><select id="existing-certificate-kind" value={invCertificateType} onChange={e=>setInvCertificateType(e.target.value as 'COURSE'|'COMPLETION')}><option value="COURSE">Course participation</option><option value="COMPLETION">Course completion</option></select>
                  {invCertificateType==='COMPLETION'&&<p>Use completion wording only when the issuer confirms course completion.</p>}
                  <label htmlFor="existing-certificate-date">Certificate date</label><input id="existing-certificate-date" type="date" required value={invCertificateDate} onChange={e=>setInvCertificateDate(e.target.value)}/>
                  <label htmlFor="existing-certificate-instructor">Instructor / signatory name (optional)</label><input id="existing-certificate-instructor" maxLength={120} value={invCertificateInstructor} onChange={e=>setInvCertificateInstructor(e.target.value)}/>
                  <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy?'Generating…':'Generate certificate'}</button><button type="button" className="btn secondary" disabled={busy} onClick={()=>setCertificateForInvoice(null)}>Cancel</button></div>
                </form>
              </div></div>
            )}

          </div>
        )}
      </section>
    </main>
  );
}
