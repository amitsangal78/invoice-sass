-- Persist provider creation outcomes and administrator-selected delivery transport.
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS external_payment_id text;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_receipt text;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS driver text NOT NULL DEFAULT 'simulation' CHECK(driver IN ('simulation','razorpay'));
CREATE UNIQUE INDEX payment_attempt_receipt_unique ON payment_attempts(provider_account_id,provider_receipt) WHERE provider_receipt IS NOT NULL;
CREATE POLICY provider_attempt_lookup ON payment_attempts FOR SELECT
USING(id=nullif(current_setting('app.provider_attempt_id',true),'')::uuid);
CREATE TABLE integration_settings (
  key text PRIMARY KEY CHECK(key='email_delivery'),
  value jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON integration_settings TO invoice_app;
GRANT INSERT,UPDATE ON integration_settings TO invoice_app;
ALTER TABLE integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_read ON integration_settings FOR SELECT USING(true);
CREATE POLICY integration_write ON integration_settings FOR INSERT WITH CHECK(is_platform_owner_context());
CREATE POLICY integration_update ON integration_settings FOR UPDATE USING(is_platform_owner_context()) WITH CHECK(is_platform_owner_context());
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS delivery_provider text;
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS provider_message_id text;
