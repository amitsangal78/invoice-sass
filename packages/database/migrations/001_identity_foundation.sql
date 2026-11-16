-- Applied by a migration owner, never the API role. Provision invoice_app separately.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  password_hash text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','REMOVED')),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','MORE_INFO','APPROVED','REJECTED','BLOCKED')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK(timezone='Asia/Kolkata'),
  blocked_at timestamptz, blocked_from_status text CHECK(blocked_from_status IN ('DRAFT','SUBMITTED','MORE_INFO','APPROVED','REJECTED')),
  block_reason text,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='BLOCKED') = (blocked_at IS NOT NULL AND blocked_from_status IS NOT NULL))
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL REFERENCES vendors(id),
  user_id uuid REFERENCES users(id), role text NOT NULL CHECK(role IN ('OWNER','CREATOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','FROZEN','REMOVED')),
  historical_label text NOT NULL, removed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vendor_id,id), UNIQUE(user_id,id),
  CHECK(status='REMOVED' OR user_id IS NOT NULL), CHECK((status='REMOVED')=(removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_owner_per_vendor ON memberships(vendor_id) WHERE role='OWNER' AND status<>'REMOVED';
CREATE UNIQUE INDEX one_membership_per_user ON memberships(user_id) WHERE status<>'REMOVED';
CREATE INDEX membership_counts ON memberships(vendor_id,role,status);

CREATE TABLE platform_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  membership_id uuid, token_hash bytea NOT NULL UNIQUE, auth_version integer NOT NULL,
  client_type text NOT NULL CHECK(client_type IN ('WEB','MOBILE')),
  restricted boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(user_id,membership_id) REFERENCES memberships(user_id,id),
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE INDEX sessions_user_expiry ON auth_sessions(user_id,expires_at);
CREATE INDEX sessions_membership ON auth_sessions(membership_id);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK(purpose='EMAIL_VERIFY'), -- other purposes arrive with their own workflows
  code_hmac bytea NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX active_otp ON otp_challenges(user_id,purpose) WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX otp_expiry ON otp_challenges(expires_at);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL REFERENCES vendors(id),
  name text NOT NULL, email text NOT NULL, phone text, address jsonb NOT NULL DEFAULT '{}'::jsonb,
  gstin text, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vendor_id,id)
);
CREATE INDEX customer_selection ON customers(vendor_id,status,name);

CREATE TABLE outbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid REFERENCES vendors(id),
  kind text NOT NULL CHECK(kind='OTP'), business_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL, encrypted_payload bytea,
  status text NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','RUNNING','RETRY','SUCCEEDED','DEAD','CANCELLED')),
  available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts>0),
  lease_token uuid, lease_until timestamptz, completed_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='RUNNING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX runnable_jobs ON outbox_jobs(available_at,id) WHERE status IN ('READY','RETRY');
CREATE INDEX leased_jobs ON outbox_jobs(lease_until) WHERE status='RUNNING';
CREATE TABLE idempotency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_scope text NOT NULL, operation text NOT NULL,
  request_key uuid NOT NULL, request_hash bytea NOT NULL,
  result jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_scope,operation,request_key)
);
CREATE TABLE rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_hash bytea NOT NULL,
  action text NOT NULL, window_start timestamptz NOT NULL, counter integer NOT NULL CHECK(counter>0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_hash,action,window_start)
);
CREATE INDEX rate_limit_cleanup ON rate_limits(expires_at);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid REFERENCES vendors(id),
  actor_membership_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id uuid,
  request_id uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(vendor_id,actor_membership_id) REFERENCES memberships(vendor_id,id)
);
CREATE INDEX tenant_audit ON audit_events(vendor_id,created_at DESC);

-- All tenant context is transaction-local and supplied only by trusted backend code.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vendors','memberships','customers','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF t='vendors' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid) WITH CHECK (id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid)',t);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (vendor_id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid) WITH CHECK (vendor_id = nullif(current_setting(''app.vendor_id'',true),'''')::uuid)',t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['users','vendors','memberships','platform_owners','auth_sessions','otp_challenges','customers','outbox_jobs','idempotency_requests','rate_limits'] LOOP
    EXECUTE format('CREATE TRIGGER updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',t);
  END LOOP;
END $$;

-- Trusted identity code sets this context only after credential/session verification.
-- SELECT-only policy cannot create/edit a membership outside tenant context.
CREATE POLICY identity_membership_lookup ON memberships FOR SELECT
USING (user_id = nullif(current_setting('app.identity_user_id',true),'')::uuid);

GRANT USAGE ON SCHEMA public TO invoice_app;
GRANT SELECT,INSERT,UPDATE ON users, vendors, memberships, auth_sessions, otp_challenges, customers, outbox_jobs, idempotency_requests, rate_limits TO invoice_app;
GRANT SELECT ON platform_owners TO invoice_app;
GRANT SELECT,INSERT ON audit_events TO invoice_app;
GRANT SELECT ON schema_migrations TO invoice_app;
-- schema_migrations and platform-owner provisioning remain migration-owner-only.
