import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import {
  signupInput, loginInput, challengeInput, verificationInput,courseCertificateInput,
  ownerOtpChallengeInput, ownerOtpVerifyInput,
  passwordRecoveryChallengeInput, passwordRecoveryVerifyInput, passwordRecoveryCompleteInput,
  passwordChangeInput,
  creatorInput, creatorResetPasswordInput, creatorFreezeInput, creatorUnfreezeInput,
  customerInput, customerPatchInput,
  catalogueItemInput, catalogueItemPatchInput,
  taxProfileInput, taxProfilePatchInput,
  invoiceDraftInput, invoiceDraftPatchInput, invoiceSubmitInput,
  invoiceRequestChangesInput, invoiceRejectInput, invoiceApproveAndIssueInput,
  invoiceCancelInput, invoiceReplacementInput, invoiceRevisionInput, invoiceRecipientEmailInput,
  publicLinkInspectInput, publicLinkOtpInput, publicLinkVerifyInput, publicLinkRenewInput,
  customerPaymentAttemptInput, customerCheckoutResultInput, customerAdvanceAttemptInput,
  manualPaymentInput, allocationBatchInput, allocationReverseInput, paymentReverseManualInput,
  creditNoteInput, creditNoteIssueInput, reconciliationResolveInput,
  recurringScheduleInput, recurringSchedulePatchInput,
  reminderRuleInput, reminderRulePatchInput,
  changeRequestInput, changeRequestReviewInput,
  vendorAssetUploadInput,
  vendorBlockInput, vendorRestoreInput,
  policy, type Actor,
} from '@invoice/contracts';
import { withTenant, type Database } from '@invoice/database';
import { type Config } from './config';
import { HttpError } from './errors';
import { identityService } from './identity';
import { vendorService } from './services/vendorService';
import { catalogueService } from './services/catalogueService';
import { invoiceService } from './services/invoiceService';
import { customerAccessService } from './services/customerAccessService';
import { paymentService } from './services/paymentService';
import { integrationService } from './services/integrationService';
import { automationService } from './services/automationService';
import { retrieveDocument } from './storage';

function staffSessionToken(req: Request): string {
  const cookie = req.headers.cookie?.split(';').map(s => s.trim()).filter(s => s.startsWith('invoice_staff=')) ?? [];
  if (cookie.length > 1 || (cookie.length && req.headers.authorization)) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Use one session credential.');
  }
  const bearer = req.headers.authorization;
  if (bearer && !/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Invalid session credential.');
  }
  const token = bearer?.slice(7) ?? cookie[0]?.slice('invoice_staff='.length);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Please log in.');
  }
  return token;
}

function customerSessionToken(req: Request): string {
  const bearer = req.headers.authorization;
  if (bearer && /^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) {
    return bearer.slice(7);
  }
  const cookie = req.headers.cookie?.split(';').map(s => s.trim()).filter(s => s.startsWith('customer_session=')) ?? [];
  const token = cookie[0]?.slice('customer_session='.length);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return token;
  throw new HttpError(401, 'CUSTOMER_AUTH_REQUIRED', 'Customer session is required.');
}

export function createApp(db: Database, config: Config) {
  const app = express();
  const identity = identityService(db, config);
  const vendorSvc = vendorService(db, config);
  const catalogueSvc = catalogueService(db);
  const invoiceSvc = invoiceService(db, config);
  const customerSvc = customerAccessService(db, config);
  const paymentSvc = paymentService(db, config);
  const automationSvc = automationService(db, config);
  const integrations=integrationService(db,config);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set('X-Request-ID', res.locals.requestId);
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    if (origin && origin !== config.WEB_ORIGIN) {
      return next(new HttpError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not allowed.'));
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type,Idempotency-Key,Authorization');
      res.sendStatus(204);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method) && (req.headers.cookie?.includes('invoice_staff=') || req.headers.cookie?.includes('customer_session=')) && origin !== config.WEB_ORIGIN) {
      return next(new HttpError(403, 'ORIGIN_FORBIDDEN', 'A trusted Origin is required.'));
    }
    next();
  });

  const rawBodies=new WeakMap<Request,string>();
  app.use(express.json({ limit: '256kb', type: 'application/json', verify:(req,_res,body)=>{rawBodies.set(req as Request,body.toString('utf8'));} }));
  const ok = (res: express.Response, data: unknown, status = 200) =>
    res.status(status).json({ data, meta: { request_id: res.locals.requestId } });

  // Health
  app.get('/api/v1/health/live', (_req, res) => ok(res, { status: 'ok', service: 'invoice-api', mode: 'TEST' }));
  app.get('/internal/health/ready', async (_req, res) => {
    try {
      const result = await db.query("SELECT 1 FROM schema_migrations WHERE name='005_invoice_templates_certificates.sql'");
      if (result.rowCount !== 1) throw new Error('migration missing');
      ok(res, { status: 'ok' });
    } catch {
      ok(res, { status: 'unavailable' }, 503);
    }
  });

  // Auth: Signup & Login
  app.post('/api/v1/auth/signup', async (req, res) => {
    if (req.get('Origin') !== config.WEB_ORIGIN) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'A trusted Origin is required for signup.');
    const input = signupInput.parse(req.body), key = z.uuid().parse(req.get('Idempotency-Key'));
    await identity.throttle(`ip:${req.ip}`, 'SIGNUP', 20);
    await identity.throttle(`email:${input.email}`, 'SIGNUP', 10);
    const result = await identity.signup(input, key, res.locals.requestId);
    const session = await identity.login({ ...input, client_type: 'WEB' });
    res.cookie('invoice_staff', session.token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 86_400_000 });
    ok(res, result, 201);
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    const input = loginInput.parse(req.body);
    if (input.client_type === 'WEB' && req.get('Origin') !== config.WEB_ORIGIN) {
      throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'A trusted Origin is required for web login.');
    }
    await identity.throttle(`ip:${req.ip}`, 'LOGIN', 60);
    await identity.throttle(`email:${input.email}`, 'LOGIN', 20);
    const result = await identity.login(input);
    if (input.client_type === 'WEB') {
      res.cookie('invoice_staff', result.token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 86_400_000 });
    }
    ok(res, { actor: result.actor, expires_at: result.expires_at, ...(input.client_type === 'MOBILE' ? { session_token: result.token } : {}) });
  });

  app.post('/api/v1/auth/email-verifications', async (req, res) => {
    const input = challengeInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'EMAIL_VERIFY', 30);
    await identity.throttle(`email:${input.email}`, 'EMAIL_VERIFY', 10);
    const id = await identity.requestChallenge(input.email, input.purpose);
    ok(res, { challenge_id: id, expires_in_seconds: 300, resend_after_seconds: 60 }, 202);
  });

  app.post('/api/v1/auth/email-verifications/verify', async (req, res) => {
    const input = verificationInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'VERIFY_ATTEMPT', 60);
    await identity.verify(input.challenge_id, input.code, 'EMAIL_VERIFY');
    ok(res, { verified: true, required_actions: ['LOGIN_OR_COMPLETE_ONBOARDING'] });
  });

  // Owner OTP
  app.post('/api/v1/auth/owner-otp/challenges', async (req, res) => {
    const input = ownerOtpChallengeInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'OWNER_OTP', 20);
    const id = await identity.requestChallenge(input.email, 'OWNER_LOGIN');
    ok(res, { challenge_id: id, expires_in_seconds: 300, resend_after_seconds: 60 }, 202);
  });

  app.post('/api/v1/auth/owner-otp/verify', async (req, res) => {
    const input = ownerOtpVerifyInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'VERIFY_ATTEMPT', 60);
    const result = await identity.ownerOtpLogin(input.challenge_id, input.code, input.client_type);
    if (input.client_type === 'WEB') {
      res.cookie('invoice_staff', result.token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 86_400_000 });
    }
    ok(res, { actor: result.actor, expires_at: result.expires_at, ...(input.client_type === 'MOBILE' ? { session_token: result.token } : {}) });
  });

  // Password recovery
  app.post('/api/v1/auth/password-recovery/challenges', async (req, res) => {
    const input = passwordRecoveryChallengeInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'PASSWORD_RECOVERY', 10);
    const id = await identity.requestChallenge(input.email, 'OWNER_RESET');
    ok(res, { challenge_id: id, expires_in_seconds: 300, resend_after_seconds: 60 }, 202);
  });

  app.post('/api/v1/auth/password-recovery/verify', async (req, res) => {
    const input = passwordRecoveryVerifyInput.parse(req.body);
    const result = await identity.passwordRecoveryVerify(input.challenge_id, input.code);
    ok(res, result);
  });

  app.get('/api/v1/auth/google/start', (req, res) => {
    const flow = req.query.flow === 'SIGNUP' ? 'SIGNUP' : 'LOGIN';
    const state = randomUUID();
    res.redirect(`${config.WEB_ORIGIN}/api/v1/auth/google/callback?state=${state}&flow=${flow}`);
  });

  app.get('/api/v1/auth/google/callback', (_req, res) => {
    res.redirect(303, `${config.WEB_ORIGIN}?oauth=complete`);
  });

  app.post('/api/v1/auth/google/exchange', (_req, _res) => {
    throw new HttpError(501, 'NOT_IMPLEMENTED', 'Google OAuth exchange is not configured in local test mode.');
  });

  app.post('/api/v1/auth/google/link', async (req, _res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER') throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    throw new HttpError(501, 'NOT_IMPLEMENTED', 'Google OAuth linking is not configured in local test mode.');
  });

  app.post('/api/v1/auth/password-recovery/complete', async (req, res) => {
    const input = passwordRecoveryCompleteInput.parse(req.body);
    await identity.passwordRecoveryComplete(input.reset_grant, input.new_password);
    res.sendStatus(204);
  });

  // Password change
  app.post('/api/v1/auth/password/change', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role === 'CREATOR') throw new HttpError(403, 'ROLE_FORBIDDEN', 'Creators cannot change passwords.');
    const input = passwordChangeInput.parse(req.body);
    await identity.passwordChange(actor.user_id, input.current_password, input.new_password);
    res.sendStatus(204);
  });

  // Sessions
  app.get('/api/v1/auth/me', async (req, res) => ok(res, await identity.authenticate(staffSessionToken(req))));
  app.post('/api/v1/auth/logout', async (req, res) => {
    await identity.logout(staffSessionToken(req));
    res.clearCookie('invoice_staff', { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.sendStatus(204);
  });
  app.get('/api/v1/auth/sessions', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await identity.listSessions(actor.user_id));
  });
  app.delete('/api/v1/auth/sessions/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    await identity.revokeSession(actor.user_id, req.params.id);
    res.sendStatus(204);
  });

  // Vendor Onboarding & Profile
  app.get('/api/v1/vendor', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await vendorSvc.getVendor(actor.vendor_id));
  });

  app.patch('/api/v1/vendor/onboarding', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await vendorSvc.patchOnboarding(actor.vendor_id, req.body, version));
  });

  app.post('/api/v1/vendor/onboarding/submit', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await vendorSvc.submitOnboarding(actor.vendor_id, actor.membership_id, version));
  });

  app.get('/api/v1/vendor/profile', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await vendorSvc.getProfile(actor.vendor_id));
  });

  app.patch('/api/v1/vendor/profile', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await vendorSvc.patchNonSensitiveProfile(actor.vendor_id, { default_tax_profile_id: req.body.default_tax_profile_id, version }));
  });

  app.post('/api/v1/vendor/change-requests', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = changeRequestInput.parse(req.body);
    ok(res, await vendorSvc.createChangeRequest(actor.vendor_id, actor.membership_id, input), 201);
  });

  app.get('/api/v1/vendor/change-requests', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await vendorSvc.listChangeRequests(actor.vendor_id));
  });

  app.post('/api/v1/vendor/change-requests/:id/email-verifications', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await vendorSvc.requestChangeRequestEmailVerification(actor.vendor_id, req.params.id), 202);
  });

  app.post('/api/v1/vendor/change-requests/:id/email-verifications/verify', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = verificationInput.parse(req.body);
    ok(res, await vendorSvc.verifyChangeRequestEmail(actor.vendor_id, req.params.id, input.challenge_id, input.code));
  });

  app.get('/api/v1/vendor/usage', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await vendorSvc.getMonthlyUsage(actor.vendor_id, req.query.month as string | undefined));
  });

  // Creator management
  app.get('/api/v1/vendor/creators', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await identity.listCreators(actor.vendor_id));
  });

  app.post('/api/v1/vendor/creators', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creatorInput.parse(req.body);
    ok(res, await identity.createCreator(actor.vendor_id, input), 201);
  });

  app.post('/api/v1/vendor/creators/:id/reset-password', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creatorResetPasswordInput.parse(req.body);
    await identity.resetCreatorPassword(actor.vendor_id, req.params.id, input.new_password);
    res.sendStatus(204);
  });

  app.post('/api/v1/vendor/creators/:id/freeze', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creatorFreezeInput.parse(req.body);
    ok(res, await identity.freezeCreator(actor.vendor_id, req.params.id, input.version));
  });

  app.post('/api/v1/vendor/creators/:id/unfreeze', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creatorUnfreezeInput.parse(req.body);
    ok(res, await identity.unfreezeCreator(actor.vendor_id, req.params.id, input.version));
  });

  app.delete('/api/v1/vendor/creators/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    await identity.deleteCreator(actor.vendor_id, req.params.id);
    res.sendStatus(204);
  });

  // Customers & Catalogue & Tax
  app.get('/api/v1/customers', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await catalogueSvc.listCustomers(actor.vendor_id, req.query.q as string, req.query.status as string));
  });

  app.post('/api/v1/customers', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = customerInput.parse(req.body);
    ok(res, await catalogueSvc.createCustomer(actor.vendor_id, input), 201);
  });

  app.get('/api/v1/customers/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await catalogueSvc.getCustomer(actor.vendor_id, req.params.id));
  });

  app.patch('/api/v1/customers/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = customerPatchInput.parse(req.body);
    ok(res, await catalogueSvc.patchCustomer(actor.vendor_id, req.params.id, input, input.version));
  });

  app.post('/api/v1/customers/:id/archive', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await catalogueSvc.archiveCustomer(actor.vendor_id, req.params.id, version));
  });

  app.get('/api/v1/invoice-options/customers', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context required.');
    ok(res, await catalogueSvc.getCustomerOptions(actor.vendor_id, req.query.q as string));
  });

  app.get('/api/v1/invoice-options/items', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context required.');
    ok(res, await catalogueSvc.getItemOptions(actor.vendor_id, req.query.q as string));
  });

  app.get('/api/v1/catalogue-items', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await catalogueSvc.listCatalogueItems(actor.vendor_id));
  });

  app.post('/api/v1/catalogue-items', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = catalogueItemInput.parse(req.body);
    ok(res, await catalogueSvc.createCatalogueItem(actor.vendor_id, input), 201);
  });

  app.patch('/api/v1/catalogue-items/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = catalogueItemPatchInput.parse(req.body);
    ok(res, await catalogueSvc.patchCatalogueItem(actor.vendor_id, req.params.id, input, input.version));
  });

  app.post('/api/v1/catalogue-items/:id/archive', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await catalogueSvc.archiveCatalogueItem(actor.vendor_id, req.params.id, version));
  });

  app.get('/api/v1/tax-profiles', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await catalogueSvc.listTaxProfiles(actor.vendor_id));
  });

  app.post('/api/v1/tax-profiles', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = taxProfileInput.parse(req.body);
    ok(res, await catalogueSvc.createTaxProfile(actor.vendor_id, input), 201);
  });

  app.patch('/api/v1/tax-profiles/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = taxProfilePatchInput.parse(req.body);
    ok(res, await catalogueSvc.patchTaxProfile(actor.vendor_id, req.params.id, input, input.version));
  });

  app.post('/api/v1/tax-profiles/:id/archive', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const version = Number(req.body.version ?? 1);
    ok(res, await catalogueSvc.archiveTaxProfile(actor.vendor_id, req.params.id, version));
  });

  // Invoices & Revisions
  app.get('/api/v1/invoices', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await invoiceSvc.listInvoices(actor, req.query as any));
  });

  for(const kind of ['invoice','certificate'] as const){
    app.post(`/api/v1/invoices/preview-${kind}`,async(req,res)=>{
      const actor=await identity.authenticate(staffSessionToken(req));
      if(!['OWNER','CREATOR'].includes(actor.role))throw new HttpError(403,'ROLE_FORBIDDEN','Vendor access required.');
      const input=invoiceDraftInput.parse(req.body);
      const content=await invoiceSvc.previewDocument(actor,input,kind==='certificate');
      res.set('Content-Type','application/pdf');res.set('Content-Disposition',`inline; filename="${kind}-preview.pdf"`);res.send(content);
    });
  }

  app.post('/api/v1/invoices/preview', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await invoiceSvc.previewInvoice(actor, req.body));
  });

  app.post('/api/v1/invoices', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceDraftInput.parse(req.body);
    ok(res, await invoiceSvc.createInvoice(actor, input), 201);
  });

  app.get('/api/v1/invoices/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await invoiceSvc.getInvoice(actor, req.params.id));
  });

  app.patch('/api/v1/invoices/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceDraftPatchInput.parse(req.body);
    ok(res, await invoiceSvc.patchInvoice(actor, req.params.id, input, input.version));
  });

  app.delete('/api/v1/invoices/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    await invoiceSvc.deleteInvoice(actor, req.params.id);
    res.sendStatus(204);
  });

  app.post('/api/v1/invoices/:id/submit', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceSubmitInput.parse(req.body);
    ok(res, await invoiceSvc.submitInvoice(actor, req.params.id, input.version));
  });

  app.post('/api/v1/invoices/:id/request-changes', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceRequestChangesInput.parse(req.body);
    ok(res, await invoiceSvc.requestChanges(actor, req.params.id, input.reason, input.version));
  });

  app.post('/api/v1/invoices/:id/reject', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceRejectInput.parse(req.body);
    ok(res, await invoiceSvc.rejectInvoice(actor, req.params.id, input.reason, input.version));
  });

  app.post('/api/v1/invoices/:id/approve-and-issue', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceApproveAndIssueInput.parse(req.body);
    ok(res, await invoiceSvc.approveAndIssue(actor, req.params.id, input.version));
  });

  app.post('/api/v1/invoices/:id/cancel', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceCancelInput.parse(req.body);
    ok(res, await invoiceSvc.cancelInvoice(actor, req.params.id, input.reason, input.version));
  });

  app.post('/api/v1/invoices/:id/replacements', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceReplacementInput.parse(req.body);
    ok(res, await invoiceSvc.createReplacement(actor, req.params.id, input.version, input.reason, input.draft), 201);
  });

  app.post('/api/v1/invoices/:id/revisions', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceRevisionInput.parse(req.body);
    ok(res, await invoiceSvc.createRevision(actor, req.params.id, input.draft, input.reason, input.version), 201);
  });

  app.get('/api/v1/invoices/:id/revisions', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await invoiceSvc.listRevisions(actor, req.params.id));
  });

  app.post('/api/v1/invoices/:id/recipient-email', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    const input = invoiceRecipientEmailInput.parse(req.body);
    ok(res, await invoiceSvc.correctRecipientEmail(actor, req.params.id, input.email, input.reason, input.version));
  });

  app.get('/api/v1/invoices/:id/history', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    ok(res, await invoiceSvc.listHistory(actor, req.params.id));
  });

  app.post('/api/v1/vendor/assets', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = vendorAssetUploadInput.parse(req.body);
    const buf = Buffer.from(input.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Asset size must not exceed 2MB.');
    const id = randomUUID();
    const objectKey = `${actor.vendor_id}/assets/${id}`;
    await db.query(
      `INSERT INTO documents(id,vendor_id,kind,object_key,mime_type,byte_size,status)
       VALUES($1,$2,$3,$4,$5,$6,'READY')`,
      [id, actor.vendor_id, input.kind, objectKey, input.mime_type, buf.length]
    );
    ok(res, { id, kind: input.kind, object_key: objectKey, byte_size: buf.length }, 201);
  });

  // Public Customer Invoice Links & Sessions
  app.post('/api/v1/public/invoice-links/inspect', async (req, res) => {
    const input = publicLinkInspectInput.parse(req.body);
    ok(res, await customerSvc.inspectLink(input.link_token));
  });

  app.post('/api/v1/public/invoice-links/otp', async (req, res) => {
    const input = publicLinkOtpInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'CUSTOMER_OTP', 20);
    ok(res, await customerSvc.requestOtp(input.link_token), 202);
  });

  app.post('/api/v1/public/invoice-links/verify', async (req, res) => {
    const input = publicLinkVerifyInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'VERIFY_ATTEMPT', 60);
    const result = await customerSvc.verifyOtp(input.link_token, input.challenge_id, input.code);
    res.cookie('customer_session', result.session_token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: policy.customerSessionMs });
    ok(res, result);
  });

  app.post('/api/v1/public/invoice-links/renew', async (req, res) => {
    const input = publicLinkRenewInput.parse(req.body);
    await identity.throttle(`ip:${req.ip}`, 'LINK_RENEW', 10);
    ok(res, await customerSvc.renewLink(input.link_token), 202);
  });

  // Customer Authorized Endpoints
  app.get('/api/v1/customer/invoice', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    ok(res, await customerSvc.getCustomerInvoice(session.vendor_id, session.invoice_id));
  });

  app.get('/api/v1/customer/invoice/documents', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    ok(res, await customerSvc.getCustomerDocuments(session.vendor_id, session.invoice_id));
  });

  app.post('/api/v1/customer/payment-attempts', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    const input = customerPaymentAttemptInput.parse(req.body);
    ok(res, await customerSvc.createPaymentAttempt(session.vendor_id, session.invoice_id, input.amount, input.method,input.request_key), 202);
  });

  app.post('/api/v1/customer/payment-attempts/:id/simulate',async(req,res)=>{
    const session=await customerSvc.authenticateSession(customerSessionToken(req));
    ok(res,await paymentSvc.simulateCustomerPayment(session.vendor_id,session.invoice_id,req.params.id));
  });

  app.post('/api/v1/customer/payment-attempts/:id/reconcile',async(req,res)=>{
    const session=await customerSvc.authenticateSession(customerSessionToken(req));
    await identity.throttle(`customer:${session.session_id}`,'PAYMENT_RECONCILE',120);
    ok(res,await paymentSvc.reconcileCustomerPayment(session.vendor_id,session.invoice_id,req.params.id));
  });

  app.get('/api/v1/customer/payment-attempts/:id', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    ok(res, await customerSvc.getPaymentAttempt(session.vendor_id, session.invoice_id, req.params.id));
  });

  app.post('/api/v1/customer/payment-attempts/:id/checkout-result', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    const input = customerCheckoutResultInput.parse(req.body);
    ok(res, await paymentSvc.verifyCustomerCheckout(session.vendor_id, session.invoice_id, req.params.id, input), 202);
  });

  app.get('/api/v1/customer/invoice/payments', async (req, res) => {
    const session = await customerSvc.authenticateSession(customerSessionToken(req));
    ok(res, await customerSvc.getScopedPayments(session.vendor_id, session.invoice_id));
  });

  app.post('/api/v1/customer/logout', async (req, res) => {
    await customerSvc.logoutCustomer(customerSessionToken(req));
    res.clearCookie('customer_session', { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.sendStatus(204);
  });

  // Payments, Allocations, Credit Notes
  app.get('/api/v1/payments', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listPayments(actor.vendor_id, req.query as any));
  });

  app.post('/api/v1/payment-attempts/:id/reconcile',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    if(actor.role!=='OWNER'||!actor.vendor_id)throw new HttpError(403,'ROLE_FORBIDDEN','Owner access required.');
    const attempt=await withTenant(db,actor.vendor_id,async client=>(await client.query('SELECT invoice_id FROM payment_attempts WHERE id=$1',[req.params.id])).rows[0]);
    if(!attempt)throw new HttpError(404,'ATTEMPT_NOT_FOUND','Payment attempt not found.');
    ok(res,await paymentSvc.reconcileCustomerPayment(actor.vendor_id,attempt.invoice_id,req.params.id));
  });

  app.get('/api/v1/payments/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.getPayment(actor.vendor_id, req.params.id));
  });

  app.get('/api/v1/payment-attempts', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listPaymentAttempts(actor.vendor_id, req.query as any));
  });

  app.post('/api/v1/customers/:id/advance-attempts', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = customerAdvanceAttemptInput.parse(req.body);
    ok(res, await paymentSvc.createAdvanceAttempt(actor.vendor_id, req.params.id, input.amount, input.method), 202);
  });

  app.post('/api/v1/payments/manual', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = manualPaymentInput.parse(req.body);
    ok(res, await paymentSvc.recordManualPayment(actor.vendor_id, actor.membership_id, input), 201);
  });

  app.post('/api/v1/payments/:id/allocations', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = allocationBatchInput.parse(req.body);
    ok(res, await paymentSvc.allocatePayment(actor.vendor_id, actor.membership_id, req.params.id, input.allocations), 201);
  });

  app.post('/api/v1/allocations/:id/reverse', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = allocationReverseInput.parse(req.body);
    ok(res, await paymentSvc.reverseAllocation(actor.vendor_id, actor.membership_id, req.params.id, input.reason, input.replacement_allocations), 201);
  });

  app.post('/api/v1/payments/:id/reverse-manual', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = paymentReverseManualInput.parse(req.body);
    ok(res, await paymentSvc.reverseManualPayment(actor.vendor_id, actor.membership_id, req.params.id, input.reason), 201);
  });

  app.post('/api/v1/invoices/:id/credit-notes', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creditNoteInput.parse(req.body);
    ok(res, await paymentSvc.createCreditNote(actor.vendor_id, actor.membership_id, input), 201);
  });

  app.post('/api/v1/credit-notes/:id/issue', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = creditNoteIssueInput.parse(req.body);
    ok(res, await paymentSvc.issueCreditNote(actor.vendor_id, actor.membership_id, req.params.id, input.version));
  });

  app.get('/api/v1/credit-notes', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listCreditNotes(actor.vendor_id, req.query as any));
  });

  app.get('/api/v1/credit-notes/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.getCreditNote(actor.vendor_id, req.params.id));
  });

  app.get('/api/v1/disputes', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listDisputes(actor.vendor_id));
  });

  app.get('/api/v1/receipts', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listReceipts(actor.vendor_id));
  });

  app.get('/api/v1/reconciliation-cases', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await paymentSvc.listReconciliationCases(actor.vendor_id));
  });

  app.post('/api/v1/reconciliation-cases/:id/resolve', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = reconciliationResolveInput.parse(req.body);
    ok(res, await paymentSvc.resolveReconciliationCase(actor.vendor_id, actor.membership_id, req.params.id, input.resolution));
  });

  // Webhooks
  app.post('/api/v1/webhooks/razorpay', async (req, res) => {
    const signature = req.get('X-Razorpay-Signature') ?? '';
    const result = await paymentSvc.handleRazorpayWebhook(rawBodies.get(req) ?? '', signature,undefined,req.get('X-Razorpay-Event-Id'));
    ok(res, result);
  });

  // Automation, Schedules, Dashboards
  app.get('/api/v1/recurring-schedules', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await automationSvc.listRecurringSchedules(actor.vendor_id));
  });

  app.post('/api/v1/recurring-schedules', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = recurringScheduleInput.parse(req.body);
    ok(res, await automationSvc.createRecurringSchedule(actor.vendor_id, actor.membership_id, input), 201);
  });

  app.get('/api/v1/recurring-schedules/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await automationSvc.getRecurringSchedule(actor.vendor_id, req.params.id));
  });

  app.patch('/api/v1/recurring-schedules/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = recurringSchedulePatchInput.parse(req.body);
    ok(res, await automationSvc.patchRecurringSchedule(actor.vendor_id, req.params.id, input, input.version));
  });

  app.get('/api/v1/reminder-rules', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await automationSvc.listReminderRules(actor.vendor_id));
  });

  app.post('/api/v1/reminder-rules', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = reminderRuleInput.parse(req.body);
    ok(res, await automationSvc.createReminderRule(actor.vendor_id, input.offset_days, input.active), 201);
  });

  app.patch('/api/v1/reminder-rules/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const input = reminderRulePatchInput.parse(req.body);
    ok(res, await automationSvc.patchReminderRule(actor.vendor_id, req.params.id, input, input.version));
  });

  app.get('/api/v1/dashboard', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await automationSvc.getOwnerDashboard(actor.vendor_id));
  });

  app.get('/api/v1/reports/:type', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    const type = req.params.type.toUpperCase() as any;
    ok(res, await automationSvc.getReport(actor.vendor_id, type, req.query));
  });

  app.get('/api/v1/audit-events', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'OWNER' || !actor.vendor_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
    ok(res, await automationSvc.listAuditEvents(actor.vendor_id));
  });

  app.get('/api/v1/admin/integrations',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    if(actor.role!=='PLATFORM_OWNER'||actor.restricted)throw new HttpError(403,'ROLE_FORBIDDEN','Verified platform owner required.');
    ok(res,await integrations.get(actor.user_id));
  });
  app.patch('/api/v1/admin/integrations/email',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    if(actor.role!=='PLATFORM_OWNER'||actor.restricted)throw new HttpError(403,'ROLE_FORBIDDEN','Verified platform owner required.');
    const input=z.strictObject({provider:z.enum(['local','ses-local','ses','resend'])}).parse(req.body);
    ok(res,await integrations.setEmail(actor.user_id,input.provider));
  });

  // Platform Admin
  app.get('/api/v1/admin/dashboard', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.getAdminDashboard(actor.user_id));
  });

  app.get('/api/v1/admin/vendors', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await vendorSvc.listAdminVendors(actor.user_id, req.query.status as string, req.query.q as string));
  });

  app.get('/api/v1/admin/vendors/:id', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await vendorSvc.getAdminVendor(actor.user_id, req.params.id));
  });

  app.get('/api/v1/admin/change-requests', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await vendorSvc.listAdminChangeRequests(actor.user_id, req.query.status as string, req.query.kind as string, req.query.vendor_id as string));
  });

  app.post('/api/v1/admin/change-requests/:id/review', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    const input = changeRequestReviewInput.parse(req.body);
    ok(res, await vendorSvc.reviewChangeRequest(req.params.id, actor.user_id, input.decision, input.reason, input.version));
  });

  app.post('/api/v1/admin/vendors/:id/block', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    const input = vendorBlockInput.parse(req.body);
    ok(res, await vendorSvc.blockVendor(actor.user_id, req.params.id, input.reason, input.version));
  });

  app.post('/api/v1/admin/vendors/:id/restore', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    const input = vendorRestoreInput.parse(req.body);
    ok(res, await vendorSvc.restoreVendor(actor.user_id, req.params.id, input.reason, input.version));
  });

  app.get('/api/v1/admin/jobs', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.listAdminJobs(actor.user_id, req.query.status as string, req.query.kind as string));
  });

  app.post('/api/v1/admin/jobs/:id/retry', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.retryAdminJob(actor.user_id, req.params.id), 202);
  });

  app.get('/api/v1/admin/provider-events', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.listAdminProviderEvents(actor.user_id));
  });

  app.post('/api/v1/admin/provider-events/:id/reprocess', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.reprocessAdminProviderEvent(actor.user_id, req.params.id), 202);
  });

  app.get('/api/v1/admin/email-suppressions', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.listEmailSuppressions(actor.user_id));
  });

  app.post('/api/v1/admin/email-suppressions/:id/clear', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.clearEmailSuppression(actor.user_id, req.params.id));
  });

  app.get('/api/v1/admin/audit-events', async (req, res) => {
    const actor = await identity.authenticate(staffSessionToken(req));
    if (actor.role !== 'PLATFORM_OWNER' || actor.restricted) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform admin only.');
    ok(res, await automationSvc.listAdminAuditEvents(actor.user_id));
  });

  // Documents are served only after checking the staff/customer invoice scope.
  async function sendDocument(res: express.Response, vendorId: string, documentId?: string, invoiceId?: string) {
    const doc = await withTenant(db,vendorId,async client=>{
      if(documentId) return (await client.query("SELECT * FROM documents WHERE id=$1 AND status='READY'",[documentId])).rows[0];
      return (await client.query(`SELECT d.* FROM documents d JOIN invoices i ON i.id=d.invoice_id
        JOIN invoice_revisions r ON r.id=d.invoice_revision_id
        WHERE d.invoice_id=$1 AND d.kind='INVOICE_PDF' AND d.status='READY' AND r.revision_no=i.current_revision_no
        ORDER BY d.created_at DESC LIMIT 1`,[invoiceId])).rows[0];
    });
    if(!doc || (invoiceId && doc.invoice_id!==invoiceId)) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Document is not available.');
    const content=await retrieveDocument(doc.object_key);
    if(!content) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Document is not available.');
    res.setHeader('Content-Type',doc.mime_type);
    res.setHeader('Content-Disposition',`inline; filename="document-${doc.id}.pdf"`);
    res.send(content);
  }
  app.post('/api/v1/invoices/:id/certificates',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    const input=courseCertificateInput.extend({request_key:z.uuid()}).parse(req.body);
    const {request_key,...details}=input;
    ok(res,await invoiceSvc.issueCourseCertificate(actor,req.params.id,details,request_key),202);
  });

  app.get('/api/v1/invoices/:id/documents',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    await invoiceSvc.getInvoice(actor,req.params.id);
    ok(res,await customerSvc.getCustomerDocuments(actor.vendor_id!,req.params.id));
  });

  app.get('/api/v1/invoices/:id/document/content',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    await invoiceSvc.getInvoice(actor,req.params.id);
    await sendDocument(res,actor.vendor_id!,undefined,req.params.id);
  });
  app.get('/api/v1/documents/:id/content',async(req,res)=>{
    const actor=await identity.authenticate(staffSessionToken(req));
    if(!actor.vendor_id) throw new HttpError(403,'ROLE_FORBIDDEN','Vendor access required.');
    const doc=await withTenant(db,actor.vendor_id,async client=>(await client.query('SELECT invoice_id FROM documents WHERE id=$1',[req.params.id])).rows[0]);
    if(!doc) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Document is not available.');
    if(doc.invoice_id) await invoiceSvc.getInvoice(actor,doc.invoice_id);
    else if(actor.role!=='OWNER') throw new HttpError(403,'ROLE_FORBIDDEN','Owner access required.');
    await sendDocument(res,actor.vendor_id,req.params.id);
  });
  app.get('/api/v1/customer/invoice/document/content',async(req,res)=>{
    const session=await customerSvc.authenticateSession(customerSessionToken(req));
    await sendDocument(res,session.vendor_id,undefined,session.invoice_id);
  });
  app.get('/api/v1/customer/documents/:id/content',async(req,res)=>{
    const session=await customerSvc.authenticateSession(customerSessionToken(req));
    await sendDocument(res,session.vendor_id,req.params.id,session.invoice_id);
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'RESOURCE_NOT_FOUND', 'This endpoint is not available.')));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'Unable to complete the request.', details: unknown;
    if (error instanceof HttpError) {
      status = error.status; code = error.code; message = error.message; details = error.details;
    } else if (error instanceof z.ZodError) {
      status = 422; code = 'VALIDATION_FAILED'; message = 'Correct the highlighted fields.';
      details = error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
    } else if (error?.type === 'entity.parse.failed') {
      status = 400; code = 'MALFORMED_REQUEST'; message = 'Invalid JSON body.';
    } else if (error?.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
    } else if (error?.code === '23505') {
      status = 409; code = 'RESOURCE_CONFLICT'; message = 'This action conflicts with existing data.';
    }
    if (status === 500) {
      console.error(JSON.stringify({ event: 'request_failed', request_id: res.locals.requestId, err: String(error) }));
    }
    if (status === 429) res.set('Retry-After', '3600');
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, meta: { request_id: res.locals.requestId } });
  };
  app.use(handleError);

  return app;
}
