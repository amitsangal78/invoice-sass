ALTER TABLE invoices ADD COLUMN document_options jsonb NOT NULL DEFAULT '{"template":"STANDARD","certificates":[]}'::jsonb;
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK(kind IN ('INVOICE_PDF','RECEIPT_PDF','INVOICE_RECEIPT_PDF','CREDIT_NOTE_PDF','QR_UPLOAD','LOGO','COURSE_CERTIFICATE'));
ALTER TABLE documents ADD COLUMN certificate_number text;
ALTER TABLE documents ADD COLUMN certificate_index integer;
CREATE UNIQUE INDEX certificate_revision_unique ON documents(vendor_id,invoice_revision_id,certificate_index) WHERE kind='COURSE_CERTIFICATE';

-- Keep the classification printed on a historical invoice independent of catalogue edits.
ALTER TABLE invoice_lines ADD COLUMN hsn_sac text;
UPDATE invoice_lines l SET hsn_sac=c.hsn_sac FROM catalogue_items c WHERE c.id=l.catalogue_item_id;
CREATE UNIQUE INDEX invoice_pdf_revision_unique ON documents(vendor_id,invoice_revision_id) WHERE kind='INVOICE_PDF';
CREATE UNIQUE INDEX certificate_number_unique ON documents(vendor_id,certificate_number) WHERE kind='COURSE_CERTIFICATE';
