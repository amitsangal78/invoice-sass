-- Migration 002: Complete schema for MVP workflows
-- Follows Invoice-SaaS-Database-Design-v2.1

-- Extend outbox_jobs kind check
ALTER TABLE outbox_jobs DROP CONSTRAINT IF EXISTS outbox_jobs_kind_check;
ALTER TABLE outbox_jobs ADD CONSTRAINT outbox_jobs_kind_check CHECK (kind IN ('OTP', 'PDF', 'EMAIL', 'RECONCILE', 'RECURRING', 'REMINDER'));

-- Extend otp_challenges purpose check and add columns
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('EMAIL_VERIFY', 'OWNER_LOGIN', 'OWNER_RESET', 'PLATFORM_RESET', 'CUSTOMER_INVOICE'));
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS destination_ciphertext bytea;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS scope_key text;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 1;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS access_link_id uuid;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS change_request_id uuid;

-- Auth identities (Google login linked to Owner)
CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider = 'GOOGLE'),
  provider_subject text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);

-- Auth grants (Single-use reset / oauth handoff)
CREATE TABLE IF NOT EXISTS auth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('PASSWORD_RESET', 'OAUTH_HANDOFF', 'OAUTH_STATE')),
  metadata_ciphertext bytea,
  key_version integer,
  token_hash bytea NOT NULL UNIQUE,
  pkce_challenge text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_grants_expiry_idx ON auth_grants(expires_at);

-- Vendor profiles
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  version_no integer NOT NULL,
  business_name text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_email text NOT NULL,
  contact_mobile text,
  gstin text,
  default_tax_profile_id uuid,
  payment_details_ciphertext bytea,
  key_version integer,
  qr_document_id uuid,
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, version_no)
);

-- Link vendors to effective current profile
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS current_profile_id uuid REFERENCES vendor_profiles(id);

-- Change requests
CREATE TABLE IF NOT EXISTS change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('ONBOARDING', 'SENSITIVE_PROFILE')),
  target text NOT NULL CHECK (target IN ('ONBOARDING', 'LOGIN_EMAIL', 'CONTACT_EMAIL', 'CONTACT_MOBILE', 'PAYMENT_DETAILS', 'BUSINESS_IDENTITY')),
  proposed_identity_email_ciphertext bytea,
  key_version integer,
  base_profile_id uuid REFERENCES vendor_profiles(id),
  proposed_profile_id uuid REFERENCES vendor_profiles(id),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'MORE_INFO', 'APPROVED', 'REJECTED')),
  requested_by_membership_id uuid NOT NULL REFERENCES memberships(id),
  reviewed_by_id uuid REFERENCES platform_owners(id),
  reason text,
  reviewed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS change_requests_vendor_status_idx ON change_requests(vendor_id, status, created_at);

-- Add foreign key back to otp_challenges for change_request_id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otp_challenges_change_request_id_fkey') THEN
    ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_change_request_id_fkey FOREIGN KEY (change_request_id) REFERENCES change_requests(id);
  END IF;
END $$;

-- Tax profiles
CREATE TABLE IF NOT EXISTS tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('GST', 'NONE')),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculation_version text NOT NULL DEFAULT 'v1',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS tax_profiles_vendor_active_idx ON tax_profiles(vendor_id, active, name);

-- Catalogue items
CREATE TABLE IF NOT EXISTS catalogue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  sku text,
  name text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('PRODUCT', 'SERVICE')),
  unit text NOT NULL,
  unit_price numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  tax_profile_id uuid REFERENCES tax_profiles(id),
  hsn_sac text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS catalogue_items_sku_unique ON catalogue_items(vendor_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalogue_items_vendor_active_idx ON catalogue_items(vendor_id, active, name);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  created_by_membership_id uuid NOT NULL REFERENCES memberships(id),
  origin text NOT NULL CHECK (origin IN ('OWNER', 'CREATOR', 'RECURRING')),
  approval_state text NOT NULL CHECK (approval_state IN ('DRAFT', 'SUBMITTED', 'REWORK', 'APPROVED', 'REJECTED')),
  document_state text NOT NULL DEFAULT 'UNISSUED' CHECK (document_state IN ('UNISSUED', 'ISSUED', 'CANCELLED', 'SUPERSEDED')),
  current_revision_no integer NOT NULL DEFAULT 0 CHECK (current_revision_no >= 0),
  invoice_number text,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  currency char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount_total numeric(18,2) NOT NULL DEFAULT 0,
  tax_total numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0,
  seller_snapshot jsonb,
  customer_snapshot jsonb,
  tax_snapshot jsonb,
  profile_id uuid REFERENCES vendor_profiles(id),
  replaces_invoice_id uuid REFERENCES invoices(id),
  submitted_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz,
  reminders_paused boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices(vendor_id, invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_vendor_approval_idx ON invoices(vendor_id, created_by_membership_id, approval_state, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_vendor_doc_state_due_idx ON invoices(vendor_id, document_state, due_date);
CREATE INDEX IF NOT EXISTS invoices_vendor_customer_idx ON invoices(vendor_id, customer_id, created_at DESC);

-- Invoice lines
CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  catalogue_item_id uuid NOT NULL REFERENCES catalogue_items(id),
  line_no integer NOT NULL,
  catalogue_version integer NOT NULL DEFAULT 1,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  taxable_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, invoice_id, line_no)
);

-- Invoice revisions
CREATE TABLE IF NOT EXISTS invoice_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  previous_revision_id uuid REFERENCES invoice_revisions(id),
  actor_membership_id uuid NOT NULL REFERENCES memberships(id),
  reason text NOT NULL,
  header_snapshot jsonb NOT NULL,
  lines_snapshot jsonb NOT NULL,
  total numeric(18,2) NOT NULL CHECK (total >= 0),
  signed_total_delta numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, invoice_id, revision_no),
  UNIQUE (previous_revision_id)
);
CREATE INDEX IF NOT EXISTS invoice_revisions_invoice_idx ON invoice_revisions(vendor_id, invoice_id, created_at);

-- Invoice actions
CREATE TABLE IF NOT EXISTS invoice_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  actor_membership_id uuid NOT NULL REFERENCES memberships(id),
  action text NOT NULL CHECK (action IN ('SUBMIT', 'REQUEST_CHANGES', 'RESUBMIT', 'APPROVE_AND_ISSUE', 'REJECT', 'CANCEL', 'REPLACE', 'SUPERSEDE', 'REVISE', 'RECIPIENT_EMAIL_CORRECT')),
  reason text,
  invoice_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS invoice_actions_idx ON invoice_actions(vendor_id, invoice_id, created_at);

-- Document sequences
CREATE TABLE IF NOT EXISTS document_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('INVOICE', 'RECEIPT', 'CREDIT_NOTE')),
  series text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, kind, series)
);

-- Monthly usage
CREATE TABLE IF NOT EXISTS monthly_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  month_start date NOT NULL,
  issued_count integer NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  invoice_limit integer NOT NULL DEFAULT 10 CHECK (invoice_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, month_start)
);

-- Quota events
CREATE TABLE IF NOT EXISTS quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  usage_id uuid NOT NULL REFERENCES monthly_usage(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, invoice_id)
);

-- Provider accounts
CREATE TABLE IF NOT EXISTS provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider = 'RAZORPAY'),
  mode text NOT NULL CHECK (mode = 'TEST'),
  external_account_id text NOT NULL,
  secret_reference text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, mode, external_account_id)
);

-- Payment attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_id uuid REFERENCES invoices(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  purpose text NOT NULL CHECK (purpose IN ('INVOICE', 'ADVANCE')),
  requested_amount numeric(18,2) NOT NULL CHECK (requested_amount > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  method text NOT NULL CHECK (method IN ('CHECKOUT_UPI', 'PROVIDER_QR')),
  external_order_id text,
  external_qr_id text,
  status text NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'UNKNOWN')),
  expires_at timestamptz,
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_order_unique ON payment_attempts(provider_account_id, external_order_id) WHERE external_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_qr_unique ON payment_attempts(provider_account_id, external_qr_id) WHERE external_qr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_attempts_vendor_invoice_idx ON payment_attempts(vendor_id, invoice_id, status);

-- Provider events
CREATE TABLE IF NOT EXISTS provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('RAZORPAY', 'SES')),
  provider_account_id uuid REFERENCES provider_accounts(id),
  external_event_id text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload_ciphertext bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'UNMATCHED', 'FAILED')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_events_status_received_idx ON provider_events(status, received_at);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  attempt_id uuid REFERENCES payment_attempts(id),
  provider_account_id uuid REFERENCES provider_accounts(id),
  external_payment_id text,
  source text NOT NULL CHECK (source IN ('PROVIDER_TEST', 'FIXTURE', 'MANUAL_TEST')),
  method text NOT NULL CHECK (method IN ('UPI', 'BANK', 'CASH', 'OTHER')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  received_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_membership_id uuid REFERENCES memberships(id),
  reference text,
  verified_event_id uuid REFERENCES provider_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_external_id_unique ON payments(provider_account_id, external_payment_id) WHERE external_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_vendor_customer_idx ON payments(vendor_id, customer_id, received_at);

-- Payment allocations
CREATE TABLE IF NOT EXISTS payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  actor_membership_id uuid REFERENCES memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS payment_allocations_inv_idx ON payment_allocations(vendor_id, invoice_id, payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_pay_idx ON payment_allocations(vendor_id, payment_id, invoice_id);

-- Allocation reversals
CREATE TABLE IF NOT EXISTS allocation_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  allocation_id uuid NOT NULL UNIQUE REFERENCES payment_allocations(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  actor_membership_id uuid REFERENCES memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);

-- Payment reversals
CREATE TABLE IF NOT EXISTS payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  actor_membership_id uuid NOT NULL REFERENCES memberships(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);

-- Credit notes
CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  number text,
  invoice_revision_id uuid REFERENCES invoice_revisions(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  issued_at timestamptz,
  created_by_membership_id uuid NOT NULL REFERENCES memberships(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_number_unique ON credit_notes(vendor_id, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_revision_unique ON credit_notes(invoice_revision_id) WHERE invoice_revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_notes_vendor_invoice_idx ON credit_notes(vendor_id, invoice_id, status);

-- Credit note lines
CREATE TABLE IF NOT EXISTS credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_line_id uuid REFERENCES invoice_lines(id),
  description text NOT NULL,
  net_amount numeric(18,2) NOT NULL,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);

-- Disputes
CREATE TABLE IF NOT EXISTS disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  external_dispute_id text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  reason text,
  provider_account_id uuid REFERENCES provider_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS disputes_provider_dispute_unique ON disputes(provider_account_id, external_dispute_id) WHERE external_dispute_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS disputes_vendor_payment_idx ON disputes(vendor_id, payment_id, status);

-- Dispute events
CREATE TABLE IF NOT EXISTS dispute_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  dispute_id uuid NOT NULL REFERENCES disputes(id),
  provider_event_id uuid REFERENCES provider_events(id),
  event_type text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);

-- Funds adjustments
CREATE TABLE IF NOT EXISTS funds_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  dispute_id uuid REFERENCES disputes(id),
  provider_event_id uuid REFERENCES provider_events(id),
  kind text NOT NULL CHECK (kind IN ('CHARGEBACK_DEBIT', 'CHARGEBACK_RESTORE')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);

-- Receipts
CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  number text NOT NULL,
  amount_snapshot numeric(18,2) NOT NULL,
  allocation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, number)
);

-- Reconciliation cases
CREATE TABLE IF NOT EXISTS reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_id uuid REFERENCES payments(id),
  attempt_id uuid REFERENCES payment_attempts(id),
  kind text NOT NULL CHECK (kind IN ('EXCESS', 'UNKNOWN_PAYMENT', 'FUNDS_DEFICIT', 'STATUS_MISMATCH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_by_membership_id uuid REFERENCES memberships(id),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS reconciliation_cases_vendor_status_idx ON reconciliation_cases(vendor_id, status, created_at);

-- Invoice access links
CREATE TABLE IF NOT EXISTS invoice_access_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  token_hash bytea NOT NULL UNIQUE,
  destination_email_ciphertext bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaces_link_id uuid REFERENCES invoice_access_links(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS invoice_access_links_expiry_idx ON invoice_access_links(vendor_id, invoice_id, expires_at);

-- Add foreign key back to otp_challenges for access_link_id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otp_challenges_access_link_id_fkey') THEN
    ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_access_link_id_fkey FOREIGN KEY (access_link_id) REFERENCES invoice_access_links(id);
  END IF;
END $$;

-- Customer sessions
CREATE TABLE IF NOT EXISTS customer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  access_link_id uuid NOT NULL REFERENCES invoice_access_links(id),
  otp_challenge_id uuid NOT NULL UNIQUE REFERENCES otp_challenges(id),
  token_hash bytea NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions(expires_at);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('INVOICE_PDF', 'RECEIPT_PDF', 'INVOICE_RECEIPT_PDF', 'CREDIT_NOTE_PDF', 'QR_UPLOAD', 'LOGO')),
  invoice_id uuid REFERENCES invoices(id),
  receipt_id uuid REFERENCES receipts(id),
  credit_note_id uuid REFERENCES credit_notes(id),
  object_key text NOT NULL UNIQUE,
  object_version_id text,
  content_hash bytea,
  mime_type text NOT NULL,
  byte_size bigint,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'FAILED')),
  content_version integer NOT NULL DEFAULT 1,
  invoice_revision_id uuid REFERENCES invoice_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS documents_vendor_inv_idx ON documents(vendor_id, invoice_id, kind);

-- Recurring schedules
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  owner_membership_id uuid NOT NULL REFERENCES memberships(id),
  active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  frequency text NOT NULL CHECK (frequency IN ('WEEKLY', 'MONTHLY')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  next_due_at timestamptz NOT NULL,
  template jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id)
);
CREATE INDEX IF NOT EXISTS recurring_schedules_next_idx ON recurring_schedules(next_due_at) WHERE active = true;

-- Recurring occurrences
CREATE TABLE IF NOT EXISTS recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  schedule_id uuid NOT NULL REFERENCES recurring_schedules(id),
  scheduled_for timestamptz NOT NULL,
  invoice_id uuid UNIQUE REFERENCES invoices(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CREATED', 'SKIPPED', 'FAILED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, schedule_id, scheduled_for)
);

-- Reminder rules
CREATE TABLE IF NOT EXISTS reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  offset_days integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, offset_days)
);

-- Reminder deliveries
CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  rule_id uuid NOT NULL REFERENCES reminder_rules(id),
  scheduled_for timestamptz NOT NULL,
  job_id uuid REFERENCES outbox_jobs(id),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'SENT', 'SKIPPED', 'FAILED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, id),
  UNIQUE (vendor_id, invoice_id, rule_id, scheduled_for)
);

-- Email messages
CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id),
  job_id uuid NOT NULL REFERENCES outbox_jobs(id),
  attempt_no integer NOT NULL DEFAULT 1,
  template text NOT NULL,
  recipient_ciphertext bytea NOT NULL,
  recipient_hash bytea NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNCERTAIN')),
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_no)
);

-- Email event links
CREATE TABLE IF NOT EXISTS email_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id uuid NOT NULL UNIQUE REFERENCES provider_events(id),
  email_message_id uuid NOT NULL REFERENCES email_messages(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Email suppressions
CREATE TABLE IF NOT EXISTS email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_hash bytea NOT NULL UNIQUE,
  source_event_id uuid NOT NULL REFERENCES provider_events(id),
  reason text NOT NULL,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS and triggers on all tenant tables
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendor_profiles', 'change_requests', 'tax_profiles', 'catalogue_items',
    'invoices', 'invoice_lines', 'invoice_revisions', 'invoice_actions',
    'document_sequences', 'monthly_usage', 'quota_events',
    'payment_attempts', 'payments', 'payment_allocations', 'allocation_reversals', 'payment_reversals',
    'credit_notes', 'credit_note_lines', 'disputes', 'dispute_events', 'funds_adjustments',
    'receipts', 'reconciliation_cases', 'invoice_access_links', 'customer_sessions',
    'documents', 'recurring_schedules', 'recurring_occurrences', 'reminder_rules', 'reminder_deliveries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (vendor_id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid) WITH CHECK (vendor_id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid)', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'auth_grants', 'vendor_profiles', 'change_requests', 'tax_profiles', 'catalogue_items',
    'invoices', 'invoice_lines', 'document_sequences', 'monthly_usage',
    'payment_attempts', 'provider_events', 'credit_notes', 'credit_note_lines',
    'disputes', 'receipts', 'reconciliation_cases', 'invoice_access_links', 'customer_sessions',
    'documents', 'recurring_schedules', 'recurring_occurrences', 'reminder_rules', 'reminder_deliveries',
    'email_messages', 'email_suppressions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

-- Grants to invoice_app
GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_identities, auth_grants, vendor_profiles, change_requests, tax_profiles, catalogue_items,
  invoices, invoice_lines, invoice_revisions, invoice_actions, document_sequences, monthly_usage, quota_events,
  provider_accounts, payment_attempts, provider_events, payments, payment_allocations, allocation_reversals, payment_reversals,
  credit_notes, credit_note_lines, disputes, dispute_events, funds_adjustments, receipts, reconciliation_cases,
  invoice_access_links, customer_sessions, documents, recurring_schedules, recurring_occurrences,
  reminder_rules, reminder_deliveries, email_messages, email_event_links, email_suppressions
TO invoice_app;
