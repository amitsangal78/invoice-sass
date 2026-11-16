-- Explicit transaction-local access for authenticated platform administrators.
-- Runtime remains non-superuser/NOBYPASSRLS; ordinary tenant policies are unchanged.
CREATE FUNCTION is_platform_owner_context() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_owners po JOIN users u ON u.id=po.user_id
    WHERE po.user_id=nullif(current_setting('app.platform_owner_id',true),'')::uuid
      AND po.status='ACTIVE' AND u.status='ACTIVE' AND u.email_verified_at IS NOT NULL
  )
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vendors','memberships','vendor_profiles','change_requests','audit_events'] LOOP
    EXECUTE format('CREATE POLICY platform_owner_read ON %I FOR SELECT USING (is_platform_owner_context())',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['vendors','vendor_profiles','change_requests'] LOOP
    EXECUTE format('CREATE POLICY platform_owner_update ON %I FOR UPDATE USING (is_platform_owner_context()) WITH CHECK (is_platform_owner_context())',t);
  END LOOP;
END $$;

-- Bootstrap only the row matching possession of a hashed capability, then set
-- vendor context on the same transaction before joining any tenant tables.
CREATE POLICY link_capability_lookup ON invoice_access_links FOR SELECT
USING (token_hash=decode(nullif(current_setting('app.link_token_hash',true),''),'hex'));
CREATE POLICY session_capability_lookup ON customer_sessions FOR SELECT
USING (token_hash=decode(nullif(current_setting('app.customer_token_hash',true),''),'hex'));
CREATE POLICY provider_order_lookup ON payment_attempts FOR SELECT
USING (external_order_id=nullif(current_setting('app.provider_order_id',true),''));

ALTER TABLE change_requests ADD COLUMN email_verified_at timestamptz;
ALTER TABLE otp_challenges ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('EMAIL_VERIFY','OWNER_LOGIN','OWNER_RESET','PLATFORM_RESET','CUSTOMER_INVOICE','CONTACT_EMAIL_VERIFY'));
ALTER TABLE otp_challenges ADD CONSTRAINT otp_subject_required
CHECK (user_id IS NOT NULL OR access_link_id IS NOT NULL OR change_request_id IS NOT NULL);
CREATE UNIQUE INDEX active_scoped_otp ON otp_challenges(scope_key)
WHERE scope_key IS NOT NULL AND consumed_at IS NULL AND invalidated_at IS NULL;

GRANT DELETE ON memberships,users,auth_sessions,otp_challenges TO invoice_app;

-- Older issuance jobs did not populate their tenant routing field.
UPDATE outbox_jobs j SET vendor_id=i.vendor_id FROM invoices i
WHERE j.vendor_id IS NULL AND j.payload->>'invoice_id'=i.id::text;
