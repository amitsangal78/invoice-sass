import { z } from 'zod';

export const policy = Object.freeze({
  staffAbsoluteMs: 24 * 60 * 60 * 1000,
  staffIdleMs: 30 * 60 * 1000,
  customerSessionMs: 15 * 60 * 1000,
  invoiceLinkMs: 5 * 24 * 60 * 60 * 1000,
  otpMs: 5 * 60 * 1000,
  activeCreators: 5,
  existingCreators: 15,
  monthlyInvoices: 10,
  paymentMode: 'TEST',
  refundsEnabled: false,
  customerCreditEnabled: false,
  earlyLinkRenewalEnabled: false,
} as const);

export const email = z.email().max(254).transform(value => value.trim().toLowerCase());
export const password = z.string().min(12, 'Use at least 12 characters.').max(128);

// Auth schemas
export const signupInput = z.strictObject({ email, password });
export const loginInput = z.strictObject({
  email,
  password: z.string().min(1).max(128),
  client_type: z.enum(['WEB', 'MOBILE']),
});
export const verificationInput = z.strictObject({
  challenge_id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export const challengeInput = z.strictObject({
  email,
  purpose: z.enum(['EMAIL_VERIFY', 'OWNER_LOGIN', 'OWNER_RESET', 'PLATFORM_RESET', 'CUSTOMER_INVOICE']),
});
export const ownerOtpChallengeInput = z.strictObject({ email });
export const ownerOtpVerifyInput = z.strictObject({
  challenge_id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  client_type: z.enum(['WEB', 'MOBILE']),
});
export const passwordRecoveryChallengeInput = z.strictObject({ email });
export const passwordRecoveryVerifyInput = z.strictObject({
  challenge_id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export const passwordRecoveryCompleteInput = z.strictObject({
  reset_grant: z.string().min(1),
  new_password: password,
});
export const passwordChangeInput = z.strictObject({
  current_password: z.string().min(1),
  new_password: password,
});

export const healthResponse = z.strictObject({
  data: z.strictObject({
    status: z.literal('ok'),
    service: z.literal('invoice-api'),
    mode: z.literal('TEST'),
  }),
  meta: z.strictObject({ request_id: z.uuid() }),
});

export const actorSchema = z.object({
  user_id: z.uuid(),
  email: z.email(),
  role: z.enum(['OWNER', 'CREATOR', 'PLATFORM_OWNER']),
  membership_id: z.uuid().nullable(),
  vendor_id: z.uuid().nullable(),
  vendor_status: z.string().nullable(),
  restricted: z.boolean(),
  required_actions: z.array(z.string()),
});
export type Actor = z.infer<typeof actorSchema>;
export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
  meta: { request_id: string };
};

// Address & Profile
export const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state_code: z.string().min(2).max(10),
  postal_code: z.string().min(3).max(10),
  country_code: z.literal('IN').default('IN'),
});
export type Address = z.infer<typeof addressSchema>;

export const profileDraftSchema = z.object({
  business_name: z.string().min(1).max(200),
  address: addressSchema,
  contact_email: email,
  contact_mobile: z.string().max(20).optional(),
  gstin: z.string().max(20).optional(),
  default_tax_profile_id: z.uuid().optional(),
  payment_details: z.record(z.string(), z.any()).optional(),
  qr_document_id: z.uuid().optional(),
});
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

export const onboardingPatchInput = profileDraftSchema.partial().extend({
  version: z.number().int().positive(),
});

export const nonSensitiveProfilePatchInput = z.object({
  default_tax_profile_id: z.uuid().nullable().optional(),
  version: z.number().int().positive(),
});

export const changeRequestInput = z.object({
  kind: z.enum(['ONBOARDING', 'SENSITIVE_PROFILE']),
  base_profile_id: z.uuid().optional(),
  proposed_changes: z.record(z.string(), z.any()),
});

export const changeRequestReviewInput = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['APPROVE', 'REJECT', 'MORE_INFO']),
  reason: z.string().optional(),
});

export const vendorBlockInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
});

export const vendorRestoreInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().optional(),
});

// Creator management
export const creatorInput = z.object({
  email,
  password,
  status: z.enum(['ACTIVE', 'FROZEN']).default('ACTIVE'),
});

export const creatorResetPasswordInput = z.object({
  new_password: password,
});

export const creatorFreezeInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().optional(),
});

export const creatorUnfreezeInput = z.object({
  version: z.number().int().positive(),
});

// Customers
export const customerInput = z.object({
  name: z.string().min(1).max(200),
  email,
  phone: z.string().max(20).optional(),
  address: addressSchema,
  gstin: z.string().max(20).optional(),
});

export const customerPatchInput = customerInput.partial().extend({
  version: z.number().int().positive(),
});

// Tax profiles
export const taxComponentSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
});

export const taxProfileInput = z.object({
  name: z.string().min(1),
  mode: z.enum(['GST', 'NONE']),
  components: z.array(taxComponentSchema),
  calculation_version: z.string().default('v1'),
});

export const taxProfilePatchInput = taxProfileInput.partial().extend({
  version: z.number().int().positive(),
});

// Catalogue items
export const catalogueItemInput = z.object({
  sku: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  item_type: z.enum(['PRODUCT', 'SERVICE']),
  unit: z.string().min(1).max(50),
  unit_price: z.number().min(0),
  tax_profile_id: z.uuid().optional(),
  hsn_sac: z.string().max(20).optional(),
});

export const catalogueItemPatchInput = catalogueItemInput.partial().extend({
  version: z.number().int().positive(),
});

// Invoices
export const invoiceLineInput = z.object({
  catalogue_item_id: z.uuid(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
});

export const courseCertificateInput = z.object({
  recipient_name:z.string().trim().min(1).max(200),
  course_name:z.string().trim().min(1).max(200),
  awarded_on:z.iso.date(),
  style:z.enum(['NAMASTEDEV','UDEMY']).default('NAMASTEDEV'),
  certificate_type:z.enum(['COURSE','COMPLETION']).default('COURSE'),
  instructor_name:z.string().trim().max(120).optional(),
});
export const invoiceDocumentOptions=z.object({
  template:z.enum(['STANDARD','COURSE','UDEMY','SERVICE']).default('STANDARD'),
  order_reference:z.string().trim().max(120).optional(),
  place_of_supply:z.string().trim().max(120).optional(),
  shipping_address:z.string().trim().max(1000).optional(),
  service_start:z.iso.date().optional(),
  service_end:z.iso.date().optional(),
  notes:z.string().trim().max(2000).optional(),
  certificates:z.array(courseCertificateInput).max(20).default([]),
});

export const invoiceDraftInput = z.object({
  customer_id: z.uuid(),
  invoice_date: z.string().optional(),
  due_date: z.string().optional(),
  lines: z.array(invoiceLineInput).min(1),
  profile_id: z.uuid().optional(),
  document_options:invoiceDocumentOptions.optional(),
});

export const invoiceDraftPatchInput = invoiceDraftInput.partial().extend({
  version: z.number().int().positive(),
});

export const invoiceSubmitInput = z.object({
  version: z.number().int().positive(),
});

export const invoiceRequestChangesInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
});

export const invoiceRejectInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
});

export const invoiceApproveAndIssueInput = z.object({
  version: z.number().int().positive(),
});

export const invoiceCancelInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
});

export const invoiceReplacementInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
  draft: invoiceDraftInput,
});

export const invoiceRevisionInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().min(1),
  draft: invoiceDraftInput,
});

export const invoiceRecipientEmailInput = z.object({
  version: z.number().int().positive(),
  email,
  reason: z.string().min(1),
});

export const invoiceRemindersPauseInput = z.object({
  version: z.number().int().positive(),
  paused: z.boolean(),
});

// Customer Public Link & Sessions
export const publicLinkInspectInput = z.object({
  link_token: z.string().min(1),
});

export const publicLinkOtpInput = z.object({
  link_token: z.string().min(1),
});

export const publicLinkVerifyInput = z.object({
  link_token: z.string().min(1),
  challenge_id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const publicLinkRenewInput = z.object({
  link_token: z.string().min(1),
});

export const customerPaymentAttemptInput = z.object({
  request_key: z.uuid().optional(),
  amount: z.number().positive(),
  method: z.enum(['CHECKOUT_UPI', 'PROVIDER_QR']),
});

export const customerCheckoutResultInput = z.object({
  provider_order_id: z.string().optional(),
  provider_payment_id: z.string().optional(),
  provider_signature: z.string().optional(),
});

export const customerAdvanceAttemptInput = z.object({
  amount: z.number().positive(),
  method: z.enum(['CHECKOUT_UPI', 'PROVIDER_QR']),
});

// Payments, Manual, Allocations, Credit Notes
export const manualPaymentInput = z.object({
  customer_id: z.uuid(),
  invoice_id: z.uuid().optional(),
  amount: z.number().positive(),
  method: z.enum(['UPI', 'BANK', 'CASH', 'OTHER']),
  received_at: z.string().optional(),
  reference: z.string().optional(),
});

export const allocationItemInput = z.object({
  invoice_id: z.uuid(),
  amount: z.number().positive(),
});

export const allocationBatchInput = z.object({
  allocations: z.array(allocationItemInput).min(1),
});

export const allocationReverseInput = z.object({
  reason: z.string().min(1),
  replacement_allocations: z.array(allocationItemInput).optional(),
});

export const paymentReverseManualInput = z.object({
  reason: z.string().min(1),
});

export const creditNoteInput = z.object({
  invoice_id: z.uuid(),
  amount: z.number().positive(),
  reason: z.string().min(1),
  lines: z.array(z.object({
    description: z.string(),
    net_amount: z.number(),
    tax_amount: z.number().default(0),
    total: z.number(),
  })).optional(),
});

export const vendorAssetUploadInput = z.object({
  kind: z.enum(['LOGO', 'QR_UPLOAD']),
  content_base64: z.string().min(1),
  mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

export const creditNoteIssueInput = z.object({
  version: z.number().int().positive(),
  allocation_adjustments: z.array(allocationItemInput).optional(),
});

export const reconciliationResolveInput = z.object({
  resolution: z.string().min(1),
  related_adjustment_ids: z.array(z.uuid()).optional(),
});

// Automation
export const recurringScheduleInput = z.object({
  customer_id: z.uuid(),
  frequency: z.enum(['WEEKLY', 'MONTHLY']),
  interval_count: z.number().int().positive().default(1),
  template: z.record(z.string(), z.any()),
});

export const recurringSchedulePatchInput = recurringScheduleInput.partial().extend({
  version: z.number().int().positive(),
  active: z.boolean().optional(),
});

export const reminderRuleInput = z.object({
  offset_days: z.number().int(),
  active: z.boolean().default(true),
});

export const reminderRulePatchInput = z.object({
  offset_days: z.number().int().optional(),
  active: z.boolean().optional(),
  version: z.number().int().positive(),
});

// Policies & calculation helpers
export function canRenewLink(expiresAt: Date, now = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export function isStaffSessionActive(
  session: { expires_at: Date; last_seen_at: Date; revoked_at: Date | null },
  now = new Date()
): boolean {
  return (
    session.revoked_at === null &&
    session.expires_at.getTime() > now.getTime() &&
    session.last_seen_at.getTime() + policy.staffIdleMs > now.getTime()
  );
}

// Decimal calculation helpers with exact 2-decimal rounding for currency
export interface CalculatedLine {
  catalogue_item_id: string;
  line_no: number;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  taxable_amount: number;
  tax_components: { name: string; rate: number }[];
  tax_amount: number;
  line_total: number;
  hsn_sac?:string|null;
}

export interface CalculatedInvoiceTotals {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  rounding_adjustment: number;
  total: number;
  lines: CalculatedLine[];
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateLine(
  item: { id: string; name: string; unit: string; unit_price: number; tax_components?: { name: string; rate: number }[];hsn_sac?:string|null },
  lineInput: { quantity: number; unit_price?: number; discount_amount?: number },
  lineNo: number,
  isOwner = false
): CalculatedLine {
  const quantity = lineInput.quantity;
  const unitPrice = (isOwner && lineInput.unit_price !== undefined) ? lineInput.unit_price : item.unit_price;
  const rawSubtotal = roundMoney(quantity * unitPrice);
  const discountAmount = Math.min(rawSubtotal, roundMoney(isOwner ? (lineInput.discount_amount ?? 0) : 0));
  const taxableAmount = Math.max(0, roundMoney(rawSubtotal - discountAmount));
  const taxComponents = item.tax_components ?? [];
  const totalTaxRate = taxComponents.reduce((acc, c) => acc + c.rate, 0);
  const taxAmount = roundMoney(taxableAmount * (totalTaxRate / 100));
  const lineTotal = roundMoney(taxableAmount + taxAmount);

  return {
    catalogue_item_id: item.id,
    hsn_sac:item.hsn_sac,
    line_no: lineNo,
    description: item.name,
    unit: item.unit,
    quantity,
    unit_price: unitPrice,
    discount_amount: discountAmount,
    taxable_amount: taxableAmount,
    tax_components: taxComponents,
    tax_amount: taxAmount,
    line_total: lineTotal,
  };
}

export function calculateInvoiceTotals(lines: CalculatedLine[]): CalculatedInvoiceTotals {
  let subtotal = 0;
  let discount_total = 0;
  let tax_total = 0;

  for (const line of lines) {
    subtotal = roundMoney(subtotal + line.quantity * line.unit_price);
    discount_total = roundMoney(discount_total + line.discount_amount);
    tax_total = roundMoney(tax_total + line.tax_amount);
  }

  const rawTotal = roundMoney(subtotal - discount_total + tax_total);
  const roundedTotal = Math.round(rawTotal);
  const rounding_adjustment = roundMoney(roundedTotal - rawTotal);

  return {
    subtotal,
    discount_total,
    tax_total,
    rounding_adjustment,
    total: roundedTotal,
    lines,
  };
}

export function calculateCollectible(
  latestRevisionTotal: number,
  standaloneCreditNotesTotal: number
): number {
  return Math.max(0, roundMoney(latestRevisionTotal - standaloneCreditNotesTotal));
}

export function calculateOutstanding(
  collectibleAmount: number,
  netAllocations: number
): number {
  return Math.max(0, roundMoney(collectibleAmount - netAllocations));
}
