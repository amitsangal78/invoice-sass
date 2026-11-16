-- LOCAL DEVELOPMENT ONLY: production role credentials are provisioned separately.
CREATE ROLE invoice_app LOGIN PASSWORD 'invoice_local_only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE invoice_test OWNER invoice_admin;
