import { randomBytes, randomUUID } from 'node:crypto';
import { calculateInvoiceTotals, calculateLine, policy, roundMoney, type Actor } from '@invoice/contracts';
import { type Database, transaction, withTenant } from '@invoice/database';
import { seal, tokenHash } from '@invoice/database/crypto';
import type { Config } from '../config';
import { renderInvoicePdf,renderCertificatePdf } from '@invoice/documents';
import { HttpError } from '../errors';

export function invoiceService(db: Database, config: Config) {
  return {
    async listInvoices(actor: Actor, filters?: { approval_state?: string; document_state?: string; customer_id?: string }) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        let sql = `
          SELECT i.*, c.name as customer_name, c.email as customer_email,
                 coalesce((SELECT sum(amount) FROM payment_allocations pa WHERE pa.invoice_id=i.id AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)), 0) as allocated_amount,
                 coalesce((SELECT sum(amount) FROM credit_notes cn WHERE cn.invoice_id=i.id AND cn.status='ISSUED' AND cn.invoice_revision_id IS NULL), 0) as standalone_credit_amount
          FROM invoices i
          JOIN customers c ON i.customer_id=c.id
          WHERE i.vendor_id=$1
        `;
        const params: any[] = [vendorId];

        if (actor.role === 'CREATOR') {
          // Creator sees: own drafts/submissions/rework OR own issued invoices with outstanding balance > 0
          params.push(actor.membership_id);
          sql += ` AND i.created_by_membership_id=$${params.length} AND (
            i.approval_state IN ('DRAFT','SUBMITTED','REWORK')
            OR (i.document_state='ISSUED' AND (i.total - coalesce((SELECT sum(amount) FROM payment_allocations pa WHERE pa.invoice_id=i.id AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)), 0)) > 0)
          )`;
        }

        if (filters?.approval_state) {
          params.push(filters.approval_state);
          sql += ` AND i.approval_state=$${params.length}`;
        }
        if (filters?.document_state) {
          params.push(filters.document_state);
          sql += ` AND i.document_state=$${params.length}`;
        }
        if (filters?.customer_id) {
          params.push(filters.customer_id);
          sql += ` AND i.customer_id=$${params.length}`;
        }

        sql += ' ORDER BY i.created_at DESC';
        const rows = (await client.query(sql, params)).rows;
        return rows.map(r => {
          const collectible = Math.max(0, roundMoney(Number(r.total) - Number(r.standalone_credit_amount)));
          const outstanding = Math.max(0, roundMoney(collectible - Number(r.allocated_amount)));
          return {
            ...r,
            collectible_amount: collectible,
            outstanding_amount: outstanding,
            paid: r.document_state === 'ISSUED' && outstanding === 0,
          };
        });
      });
    },

    async previewInvoice(actor: Actor, draft: any) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const lines: any[] = [];
        let lineNo = 1;
        for (const l of draft.lines) {
          const item = (await client.query(
            `SELECT ci.*, tp.components as tax_components
             FROM catalogue_items ci
             LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
             WHERE ci.id=$1 AND ci.vendor_id=$2`,
            [l.catalogue_item_id, vendorId]
          )).rows[0];
          if (!item) throw new HttpError(400, 'ITEM_NOT_FOUND', `Item ${l.catalogue_item_id} not found.`);
          lines.push(calculateLine(item, l, lineNo++, actor.role === 'OWNER'));
        }
        return calculateInvoiceTotals(lines);
      });
    },

    async issueCourseCertificate(actor:Actor,id:string,details:any,requestKey:string){
      if(actor.role!=='OWNER'||!actor.vendor_id||!actor.membership_id)throw new HttpError(403,'ROLE_FORBIDDEN','Vendor Owner access required.');
      return withTenant(db,actor.vendor_id,async client=>{
        const invoice=(await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!invoice||invoice.document_state!=='ISSUED')throw new HttpError(400,'INVOICE_NOT_ISSUED','Issue the course invoice before adding its certificate.');
        const revision=(await client.query('SELECT id FROM invoice_revisions WHERE invoice_id=$1 AND revision_no=$2',[id,invoice.current_revision_no])).rows[0];
        const key=`certificate:${actor.vendor_id}:${requestKey}`,hash=tokenHash(JSON.stringify({invoice_id:id,details})).toString('hex');
        const existing=(await client.query('SELECT id,payload FROM outbox_jobs WHERE business_key=$1',[key])).rows[0];
        if(existing){if(existing.payload.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','This certificate request key was already used.');return {job_id:existing.id,certificate_number:existing.payload.certificate_number};}
        const documentId=randomUUID(),number=`CERT-${invoice.invoice_number}-${documentId.slice(0,8).toUpperCase()}`;
        const job=(await client.query(`INSERT INTO outbox_jobs(kind,vendor_id,business_key,payload,encrypted_payload) VALUES('PDF',$1,$2,$3,$4) RETURNING id`,[actor.vendor_id,key,JSON.stringify({kind:'COURSE_CERTIFICATE',invoice_id:id,revision_id:revision.id,document_id:documentId,certificate_number:number,request_hash:hash}),seal(details,config.DELIVERY_KEY)])).rows[0];
        await client.query(`INSERT INTO audit_events(vendor_id,actor_membership_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'COURSE_CERTIFICATE_REQUESTED','invoices',$3,$4)`,[actor.vendor_id,actor.membership_id,id,requestKey]);
        return {job_id:job.id,certificate_number:number};
      });
    },

    async previewDocument(actor:Actor,draft:any,certificate=false){
      if(!actor.vendor_id)throw new HttpError(403,'VENDOR_REQUIRED','Vendor context required.');
      const totals=await this.previewInvoice(actor,draft);
      const context=await withTenant(db,actor.vendor_id,async client=>{
        const customer=(await client.query('SELECT * FROM customers WHERE id=$1',[draft.customer_id])).rows[0];
        if(!customer)throw new HttpError(400,'CUSTOMER_NOT_FOUND','Customer not found.');
        const seller=(await client.query('SELECT p.* FROM vendors v JOIN vendor_profiles p ON p.id=v.current_profile_id WHERE v.id=$1',[actor.vendor_id])).rows[0]??{};
        return {seller,customer};
      });
      if(certificate){
        const details=draft.document_options?.certificates?.[0];
        if(!details)throw new HttpError(422,'CERTIFICATE_REQUIRED','Enable a course certificate first.');
        return renderCertificatePdf(details,context.seller.business_name??'Course provider','PREVIEW-NOT-ISSUED','DRAFT');
      }
      return renderInvoicePdf({...draft,...context,...totals,invoice_number:'DRAFT',invoice_date:draft.invoice_date??new Date().toISOString().slice(0,10)},totals.lines);
    },

    async createInvoice(actor: Actor, draft: any) {
      if (!actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const customer = (await client.query('SELECT * FROM customers WHERE id=$1 AND vendor_id=$2', [draft.customer_id, vendorId])).rows[0];
        if (!customer) throw new HttpError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found.');

        const calculatedLines: any[] = [];
        let lineNo = 1;
        for (const l of draft.lines) {
          const item = (await client.query(
            `SELECT ci.*, tp.components as tax_components
             FROM catalogue_items ci
             LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
             WHERE ci.id=$1 AND ci.vendor_id=$2`,
            [l.catalogue_item_id, vendorId]
          )).rows[0];
          if (!item) throw new HttpError(400, 'ITEM_NOT_FOUND', `Item ${l.catalogue_item_id} not found.`);
          calculatedLines.push(calculateLine(item, l, lineNo++, actor.role === 'OWNER'));
        }
        const totals = calculateInvoiceTotals(calculatedLines);
        const invoiceId = randomUUID();

        const row = (await client.query(
          `INSERT INTO invoices(
             id,vendor_id,customer_id,created_by_membership_id,origin,approval_state,document_state,
             invoice_date,due_date,subtotal,discount_total,tax_total,rounding_adjustment,total,customer_snapshot,document_options
           )
           VALUES($1,$2,$3,$4,$5,'DRAFT','UNISSUED',$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            invoiceId,
            vendorId,
            draft.customer_id,
            actor.membership_id,
            actor.role === 'OWNER' ? 'OWNER' : 'CREATOR',
            draft.invoice_date ?? new Date().toISOString().slice(0, 10),
            draft.due_date ?? null,
            totals.subtotal,
            totals.discount_total,
            totals.tax_total,
            totals.rounding_adjustment,
            totals.total,
            JSON.stringify(customer),
            JSON.stringify(draft.document_options??{template:'STANDARD',certificates:[]}),
          ]
        )).rows[0];

        for (const cl of calculatedLines) {
          await client.query(
            `INSERT INTO invoice_lines(
               id,vendor_id,invoice_id,catalogue_item_id,line_no,description,unit,
               quantity,unit_price,discount_amount,tax_components,taxable_amount,tax_amount,line_total,hsn_sac
             )
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              randomUUID(),
              vendorId,
              invoiceId,
              cl.catalogue_item_id,
              cl.line_no,
              cl.description,
              cl.unit,
              cl.quantity,
              cl.unit_price,
              cl.discount_amount,
              JSON.stringify(cl.tax_components),
              cl.taxable_amount,
              cl.tax_amount,
              cl.line_total,
              cl.hsn_sac ?? null,
            ]
          );
        }

        return { ...row, lines: calculatedLines };
      });
    },

    async getInvoice(actor: Actor, id: string) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query(
          `SELECT i.*, c.name as customer_name, c.email as customer_email,
                  coalesce((SELECT sum(amount) FROM payment_allocations pa WHERE pa.invoice_id=i.id AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)), 0) as allocated_amount,
                  coalesce((SELECT sum(amount) FROM credit_notes cn WHERE cn.invoice_id=i.id AND cn.status='ISSUED' AND cn.invoice_revision_id IS NULL), 0) as standalone_credit_amount
           FROM invoices i
           JOIN customers c ON i.customer_id=c.id
           WHERE i.id=$1 AND i.vendor_id=$2`,
          [id, vendorId]
        )).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');

        // Enforce Creator visibility rule
        if (actor.role === 'CREATOR') {
          const isOwn = inv.created_by_membership_id === actor.membership_id;
          const collectible = Math.max(0, roundMoney(Number(inv.total) - Number(inv.standalone_credit_amount)));
          const outstanding = Math.max(0, roundMoney(collectible - Number(inv.allocated_amount)));
          const allowed = isOwn && (['DRAFT', 'SUBMITTED', 'REWORK'].includes(inv.approval_state) || (inv.document_state === 'ISSUED' && outstanding > 0));
          if (!allowed) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        }

        const lines = (await client.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no ASC', [id])).rows;
        const collectible = Math.max(0, roundMoney(Number(inv.total) - Number(inv.standalone_credit_amount)));
        const outstanding = Math.max(0, roundMoney(collectible - Number(inv.allocated_amount)));
        return {
          ...inv,
          lines,
          collectible_amount: collectible,
          outstanding_amount: outstanding,
          paid: inv.document_state === 'ISSUED' && outstanding === 0,
        };
      });
    },

    async patchInvoice(actor: Actor, id: string, draft: any, version: number) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');

        if (actor.role === 'CREATOR') {
          if (inv.created_by_membership_id !== actor.membership_id) throw new HttpError(403, 'FORBIDDEN', 'Cannot edit another creator invoice.');
          if (!['DRAFT', 'REWORK'].includes(inv.approval_state)) throw new HttpError(400, 'INVALID_LIFECYCLE', 'Submitted or issued invoices cannot be edited.');
        } else if (inv.document_state !== 'UNISSUED') {
          throw new HttpError(400, 'INVALID_LIFECYCLE', 'Issued invoices must use the revision endpoint.');
        }

        const customerId = draft.customer_id ?? inv.customer_id;
        const customer = (await client.query('SELECT * FROM customers WHERE id=$1 AND vendor_id=$2', [customerId, vendorId])).rows[0];
        if (!customer) throw new HttpError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found.');

        let calculatedLines = (await client.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no ASC', [id])).rows;
        let totals = { subtotal: inv.subtotal, discount_total: inv.discount_total, tax_total: inv.tax_total, rounding_adjustment: inv.rounding_adjustment, total: inv.total };

        if (draft.lines) {
          calculatedLines = [];
          let lineNo = 1;
          for (const l of draft.lines) {
            const item = (await client.query(
              `SELECT ci.*, tp.components as tax_components
               FROM catalogue_items ci
               LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
               WHERE ci.id=$1 AND ci.vendor_id=$2`,
              [l.catalogue_item_id, vendorId]
            )).rows[0];
            if (!item) throw new HttpError(400, 'ITEM_NOT_FOUND', `Item ${l.catalogue_item_id} not found.`);
            calculatedLines.push(calculateLine(item, l, lineNo++, actor.role === 'OWNER'));
          }
          totals = calculateInvoiceTotals(calculatedLines);
          await client.query('DELETE FROM invoice_lines WHERE invoice_id=$1', [id]);
          for (const cl of calculatedLines) {
            await client.query(
              `INSERT INTO invoice_lines(
                 id,vendor_id,invoice_id,catalogue_item_id,line_no,description,unit,
                 quantity,unit_price,discount_amount,tax_components,taxable_amount,tax_amount,line_total,hsn_sac
               )
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
              [
                randomUUID(),
                vendorId,
                id,
                cl.catalogue_item_id,
                cl.line_no,
                cl.description,
                cl.unit,
                cl.quantity,
                cl.unit_price,
                cl.discount_amount,
                JSON.stringify(cl.tax_components),
                cl.taxable_amount,
                cl.tax_amount,
                cl.line_total,
                cl.hsn_sac ?? null,
              ]
            );
          }
        }

        const updated = (await client.query(
          `UPDATE invoices SET
             customer_id=$3,
             due_date=coalesce($4,due_date),
             subtotal=$5,
             discount_total=$6,
             tax_total=$7,
             rounding_adjustment=$8,
             total=$9,
             customer_snapshot=$10,
             document_options=coalesce($11::jsonb,document_options),
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [
            id,
            vendorId,
            customerId,
            draft.due_date,
            totals.subtotal,
            totals.discount_total,
            totals.tax_total,
            totals.rounding_adjustment,
            totals.total,
            JSON.stringify(customer),
            draft.document_options?JSON.stringify(draft.document_options):null,
          ]
        )).rows[0];

        return { ...updated, lines: calculatedLines };
      });
    },

    async deleteInvoice(actor: Actor, id: string) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');

        if (actor.role === 'CREATOR') {
          if (inv.created_by_membership_id !== actor.membership_id) throw new HttpError(403, 'FORBIDDEN', 'Not authorized.');
          if (inv.approval_state !== 'DRAFT') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Submitted invoices cannot be deleted.');
        } else if (inv.document_state !== 'UNISSUED' || inv.current_revision_no > 0) {
          throw new HttpError(400, 'INVALID_LIFECYCLE', 'Issued invoices cannot be deleted.');
        }

        await client.query('DELETE FROM invoice_lines WHERE invoice_id=$1', [id]);
        await client.query('DELETE FROM invoices WHERE id=$1', [id]);
      });
    },

    async submitInvoice(actor: Actor, id: string, version: number) {
      if (actor.role !== 'CREATOR') throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only Invoice Creators submit invoices for review. Vendor Owners issue their own drafts directly.');
      if (!actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.origin !== 'CREATOR' || inv.created_by_membership_id !== actor.membership_id) throw new HttpError(403, 'FORBIDDEN', 'Not authorized.');
        if (!['DRAFT', 'REWORK'].includes(inv.approval_state)) throw new HttpError(400, 'INVALID_LIFECYCLE', 'Invoice cannot be submitted.');

        await client.query(
          "UPDATE invoices SET approval_state='SUBMITTED',submitted_at=now(),version=version+1 WHERE id=$1",
          [id]
        );
        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,invoice_version)
           VALUES($1,$2,$3,$4,'SUBMIT',$5)`,
          [randomUUID(), vendorId, id, actor.membership_id, inv.version]
        );
        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async requestChanges(actor: Actor, id: string, reason: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.origin !== 'CREATOR') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Review decisions apply only to Creator invoices.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.approval_state !== 'SUBMITTED') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Only submitted invoices can be sent for rework.');

        await client.query("UPDATE invoices SET approval_state='REWORK',version=version+1 WHERE id=$1", [id]);
        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'REQUEST_CHANGES',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );
        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async rejectInvoice(actor: Actor, id: string, reason: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.origin !== 'CREATOR') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Review decisions apply only to Creator invoices.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (!['SUBMITTED', 'REWORK'].includes(inv.approval_state)) throw new HttpError(400, 'INVALID_LIFECYCLE', 'Cannot reject unsubmitted or issued invoice.');

        await client.query("UPDATE invoices SET approval_state='REJECTED',version=version+1 WHERE id=$1", [id]);
        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'REJECT',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );
        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async approveAndIssue(actor: Actor, id: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT status,current_profile_id FROM vendors WHERE id=$1', [vendorId])).rows[0];
        if (vendor.status !== 'APPROVED') {
          throw new HttpError(403, 'ONBOARDING_REQUIRED', 'Vendor onboarding must be approved before issuing invoices.');
        }

        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.document_state === 'ISSUED') throw new HttpError(400, 'ALREADY_ISSUED', 'Invoice was already issued.');
        if (inv.document_state !== 'UNISSUED') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Only unissued invoices can be issued.');
        if (inv.origin === 'CREATOR' && inv.approval_state !== 'SUBMITTED') throw new HttpError(400, 'REVIEW_REQUIRED', 'The Creator must submit this invoice before Owner approval.');
        if (inv.origin !== 'CREATOR' && !['DRAFT','REWORK','SUBMITTED'].includes(inv.approval_state)) throw new HttpError(400, 'INVALID_LIFECYCLE', 'This invoice cannot be issued.');

        // Monthly Quota Check (10 invoices per India calendar month)
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let usage = (await client.query('SELECT * FROM monthly_usage WHERE vendor_id=$1 AND month_start=$2 FOR UPDATE', [vendorId, monthStart])).rows[0];
        if (!usage) {
          usage = (await client.query(
            'INSERT INTO monthly_usage(id,vendor_id,month_start,issued_count,invoice_limit) VALUES($1,$2,$3,0,10) RETURNING *',
            [randomUUID(), vendorId, monthStart]
          )).rows[0];
        }
        if (usage.issued_count >= usage.invoice_limit) {
          throw new HttpError(429, 'QUOTA_EXCEEDED', 'Monthly invoice quota of 10 reached.');
        }

        // Sequence number allocation
        const year = new Date().getFullYear();
        const series = `${year}`;
        let seqRow = (await client.query(
          "SELECT * FROM document_sequences WHERE vendor_id=$1 AND kind='INVOICE' AND series=$2 FOR UPDATE",
          [vendorId, series]
        )).rows[0];
        if (!seqRow) {
          seqRow = (await client.query(
            "INSERT INTO document_sequences(id,vendor_id,kind,series,next_value) VALUES($1,$2,'INVOICE',$3,1) RETURNING *",
            [randomUUID(), vendorId, series]
          )).rows[0];
        }
        const invoiceNo = `INV-${year}-${String(seqRow.next_value).padStart(4, '0')}`;
        await client.query('UPDATE document_sequences SET next_value=next_value+1 WHERE id=$1', [seqRow.id]);

        // Seller profile snapshot
        const sellerProfile = vendor.current_profile_id
          ? (await client.query('SELECT * FROM vendor_profiles WHERE id=$1', [vendor.current_profile_id])).rows[0]
          : {};
        const customer = (await client.query('SELECT * FROM customers WHERE id=$1', [inv.customer_id])).rows[0];
        const lines = (await client.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no ASC', [id])).rows;

        // Create immutable invoice_revision 1
        const revisionId = randomUUID();
        await client.query(
          `INSERT INTO invoice_revisions(
             id,vendor_id,invoice_id,revision_no,actor_membership_id,reason,
             header_snapshot,lines_snapshot,total,signed_total_delta
           )
           VALUES($1,$2,$3,1,$4,'Initial issuance',$5,$6,$7,0)`,
          [
            revisionId,
            vendorId,
            id,
            actor.membership_id,
            JSON.stringify({ ...inv, invoice_number: invoiceNo, seller: sellerProfile, customer }),
            JSON.stringify(lines),
            inv.total,
          ]
        );

        // Increment monthly usage and record quota event
        await client.query('UPDATE monthly_usage SET issued_count=issued_count+1 WHERE id=$1', [usage.id]);
        await client.query(
          'INSERT INTO quota_events(id,vendor_id,invoice_id,usage_id) VALUES($1,$2,$3,$4)',
          [randomUUID(), vendorId, id, usage.id]
        );

        // Mark invoice ISSUED
        await client.query(
          `UPDATE invoices SET
             approval_state='APPROVED',
             document_state='ISSUED',
             current_revision_no=1,
             invoice_number=$2,
             seller_snapshot=$3,
             issued_at=now(),
             version=version+1
           WHERE id=$1`,
          [id, invoiceNo, JSON.stringify(sellerProfile)]
        );

        // Record action
        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,invoice_version)
           VALUES($1,$2,$3,$4,'APPROVE_AND_ISSUE',$5)`,
          [randomUUID(), vendorId, id, actor.membership_id, inv.version]
        );

        // Create initial 5-day customer access link
        const linkToken = randomBytes(32).toString('base64url');
        const linkId = randomUUID();
        await client.query(
          `INSERT INTO invoice_access_links(id,vendor_id,invoice_id,token_hash,destination_email_ciphertext,issued_at,expires_at)
           VALUES($1,$2,$3,$4,$5,now(),now()+interval '5 days')`,
          [linkId, vendorId, id, tokenHash(linkToken), seal({ email: customer.email }, config.DELIVERY_KEY)]
        );

        // Queue outbox jobs for PDF and delivery email
        await client.query(
          `INSERT INTO outbox_jobs(kind,business_key,payload,vendor_id)
           VALUES('PDF',$1,$2,$3)`,
          [`pdf:invoice:${id}:rev1`, JSON.stringify({ kind: 'INVOICE_PDF', invoice_id: id, revision_id: revisionId }), vendorId]
        );
        await client.query(
          `INSERT INTO outbox_jobs(kind,business_key,payload,encrypted_payload)
           VALUES('EMAIL',$1,$2,$3)`,
          [
            `email:invoice-delivery:${id}`,
            JSON.stringify({ kind: 'INVOICE_DELIVERY', invoice_id: id, link_id: linkId }),
            seal({ to: customer.email, invoice_number: invoiceNo, link_token: linkToken }, config.DELIVERY_KEY),
          ]
        );

        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async cancelInvoice(actor: Actor, id: string, reason: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.document_state !== 'ISSUED') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Only issued invoices can be cancelled.');

        const activeAllocations = Number((await client.query(
          'SELECT count(*) FROM payment_allocations pa WHERE pa.invoice_id=$1 AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)',
          [id]
        )).rows[0].count);
        if (activeAllocations > 0) throw new HttpError(400, 'HAS_PAYMENTS', 'Cannot cancel an invoice with active payments. Use credit note or revision.');

        await client.query("UPDATE invoices SET document_state='CANCELLED',cancelled_at=now(),version=version+1 WHERE id=$1", [id]);
        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'CANCEL',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );
        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async createRevision(actor: Actor, id: string, draft: any, reason: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.document_state !== 'ISSUED') throw new HttpError(400, 'NOT_ISSUED', 'Only issued invoices can be revised.');

        const calculatedLines: any[] = [];
        let lineNo = 1;
        for (const l of draft.lines) {
          const item = (await client.query(
            `SELECT ci.*, tp.components as tax_components
             FROM catalogue_items ci
             LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
             WHERE ci.id=$1 AND ci.vendor_id=$2`,
            [l.catalogue_item_id, vendorId]
          )).rows[0];
          if (!item) throw new HttpError(400, 'ITEM_NOT_FOUND', `Item ${l.catalogue_item_id} not found.`);
          calculatedLines.push(calculateLine(item, l, lineNo++, true));
        }
        const totals = calculateInvoiceTotals(calculatedLines);
        const signedDelta = roundMoney(totals.total - Number(inv.total));
        const nextRevNo = inv.current_revision_no + 1;
        const revId = randomUUID();

        // Get prior revision
        const priorRev = (await client.query(
          'SELECT id FROM invoice_revisions WHERE invoice_id=$1 AND revision_no=$2',
          [id, inv.current_revision_no]
        )).rows[0];

        await client.query(
          `INSERT INTO invoice_revisions(
             id,vendor_id,invoice_id,revision_no,previous_revision_id,actor_membership_id,reason,
             header_snapshot,lines_snapshot,total,signed_total_delta
           )
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            revId,
            vendorId,
            id,
            nextRevNo,
            priorRev?.id ?? null,
            actor.membership_id,
            reason,
            JSON.stringify({ ...inv, ...totals, current_revision_no:nextRevNo, document_options:draft.document_options??inv.document_options, seller: inv.seller_snapshot, customer: inv.customer_snapshot }),
            JSON.stringify(calculatedLines),
            totals.total,
            signedDelta,
          ]
        );

        // If delta is negative, create a revision-linked credit note
        if (signedDelta < 0) {
          const creditAmount = Math.abs(signedDelta);
          const cnId = randomUUID();
          await client.query(
            `INSERT INTO credit_notes(
               id,vendor_id,customer_id,invoice_id,invoice_revision_id,status,amount,reason,issued_at,created_by_membership_id
             )
             VALUES($1,$2,$3,$4,$5,'ISSUED',$6,$7,now(),$8)`,
            [cnId, vendorId, inv.customer_id, id, revId, creditAmount, `Revision reduction: ${reason}`, actor.membership_id]
          );

          // Check if allocations exceed new collectible amount; release excess allocations to customer credit
          const activeAllocations = (await client.query(
            'SELECT pa.* FROM payment_allocations pa WHERE pa.invoice_id=$1 AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)',
            [id]
          )).rows;
          const totalAllocated = activeAllocations.reduce((acc, a) => acc + Number(a.amount), 0);
          if (totalAllocated > totals.total) {
            let excess = roundMoney(totalAllocated - totals.total);
            for (const alloc of activeAllocations) {
              if (excess <= 0) break;
              const allocAmt = Number(alloc.amount);
              const reverseAmt = Math.min(excess, allocAmt);
              await client.query(
                `INSERT INTO allocation_reversals(id,vendor_id,allocation_id,amount,reason,actor_membership_id)
                 VALUES($1,$2,$3,$4,'Excess allocation released to customer credit on invoice revision',$5)`,
                [randomUUID(), vendorId, alloc.id, allocAmt, actor.membership_id]
              );
              if (allocAmt > reverseAmt) {
                // Re-allocate the remainder
                await client.query(
                  `INSERT INTO payment_allocations(id,vendor_id,customer_id,payment_id,invoice_id,amount,actor_membership_id)
                   VALUES($1,$2,$3,$4,$5,$6,$7)`,
                  [randomUUID(), vendorId, alloc.customer_id, alloc.payment_id, id, roundMoney(allocAmt - reverseAmt), actor.membership_id]
                );
              }
              excess = roundMoney(excess - reverseAmt);
            }
          }
        }

        // Replace invoice lines
        await client.query('DELETE FROM invoice_lines WHERE invoice_id=$1', [id]);
        for (const cl of calculatedLines) {
          await client.query(
            `INSERT INTO invoice_lines(
               id,vendor_id,invoice_id,catalogue_item_id,line_no,description,unit,
               quantity,unit_price,discount_amount,tax_components,taxable_amount,tax_amount,line_total,hsn_sac
             )
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              randomUUID(),
              vendorId,
              id,
              cl.catalogue_item_id,
              cl.line_no,
              cl.description,
              cl.unit,
              cl.quantity,
              cl.unit_price,
              cl.discount_amount,
              JSON.stringify(cl.tax_components),
              cl.taxable_amount,
              cl.tax_amount,
              cl.line_total,
              cl.hsn_sac ?? null,
            ]
          );
        }

        // Update invoice header
        await client.query(
          `UPDATE invoices SET
             current_revision_no=$2,
             subtotal=$3,
             discount_total=$4,
             tax_total=$5,
             rounding_adjustment=$6,
             total=$7,
             document_options=coalesce($8::jsonb,document_options),
             version=version+1
           WHERE id=$1`,
          [id, nextRevNo, totals.subtotal, totals.discount_total, totals.tax_total, totals.rounding_adjustment, totals.total,draft.document_options?JSON.stringify(draft.document_options):null]
        );

        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'REVISE',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );

        await client.query("INSERT INTO outbox_jobs(kind,vendor_id,business_key,payload) VALUES('PDF',$1,$2,$3)",[vendorId,`pdf:invoice:${id}:rev${nextRevNo}`,JSON.stringify({invoice_id:id,revision_id:revId})]);
        return (await client.query('SELECT * FROM invoice_revisions WHERE id=$1', [revId])).rows[0];
      });
    },

    async createReplacement(actor: Actor, id: string, version: number, reason: string, draft: any) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');
        if (inv.document_state !== 'ISSUED') throw new HttpError(400, 'INVALID_STATE', 'Only issued invoices can be replaced.');

        const allocCount = (await client.query("SELECT count(*) FROM payment_allocations WHERE invoice_id=$1 AND id NOT IN (SELECT allocation_id FROM allocation_reversals)", [id])).rows[0].count;
        if (Number(allocCount) > 0) throw new HttpError(400, 'PAYMENT_EXISTS', 'Paid or part-paid invoices must use revisions, not replacement.');

        const pendingAttempt = (await client.query("SELECT id FROM payment_attempts WHERE invoice_id=$1 AND status IN ('PENDING','UNKNOWN')", [id])).rows[0];
        if (pendingAttempt) throw new HttpError(409, 'PAYMENT_ATTEMPT_PENDING', 'Cannot replace invoice while a payment attempt is unresolved.');

        const replacement = await this.createInvoice(actor, draft);

        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'REPLACEMENT_CREATED',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );

        return replacement;
      });
    },

    async correctRecipientEmail(actor: Actor, id: string, newEmail: string, reason: string, version: number) {
      if (actor.role !== 'OWNER' || !actor.vendor_id || !actor.membership_id) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Invoice was modified.');

        // Revoke all prior links and customer sessions for this invoice
        await client.query('UPDATE invoice_access_links SET revoked_at=now() WHERE invoice_id=$1 AND revoked_at IS NULL', [id]);
        await client.query('UPDATE customer_sessions SET revoked_at=now() WHERE invoice_id=$1 AND revoked_at IS NULL', [id]);

        // Generate fresh 5-day link for new recipient
        const linkToken = randomBytes(32).toString('base64url');
        const linkId = randomUUID();
        await client.query(
          `INSERT INTO invoice_access_links(id,vendor_id,invoice_id,token_hash,destination_email_ciphertext,issued_at,expires_at)
           VALUES($1,$2,$3,$4,$5,now(),now()+interval '5 days')`,
          [linkId, vendorId, id, tokenHash(linkToken), seal({ email: newEmail }, config.DELIVERY_KEY)]
        );

        // Update customer snapshot on invoice
        const currentSnapshot = inv.customer_snapshot ?? {};
        const updatedSnapshot = { ...currentSnapshot, email: newEmail };
        await client.query('UPDATE invoices SET customer_snapshot=$2,version=version+1 WHERE id=$1', [id, JSON.stringify(updatedSnapshot)]);

        await client.query(
          `INSERT INTO invoice_actions(id,vendor_id,invoice_id,actor_membership_id,action,reason,invoice_version)
           VALUES($1,$2,$3,$4,'RECIPIENT_EMAIL_CORRECT',$5,$6)`,
          [randomUUID(), vendorId, id, actor.membership_id, reason, inv.version]
        );

        await client.query(
          `INSERT INTO outbox_jobs(kind,business_key,payload,encrypted_payload)
           VALUES('EMAIL',$1,$2,$3)`,
          [
            `email:invoice-delivery:${id}:${linkId}`,
            JSON.stringify({ kind: 'INVOICE_DELIVERY', invoice_id: id, link_id: linkId }),
            seal({ to: newEmail, invoice_number: inv.invoice_number, link_token: linkToken }, config.DELIVERY_KEY),
          ]
        );

        return (await client.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
      });
    },

    async listRevisions(actor: Actor, id: string) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM invoice_revisions WHERE invoice_id=$1 AND vendor_id=$2 ORDER BY revision_no ASC', [id, vendorId])).rows;
      });
    },

    async listHistory(actor: Actor, id: string) {
      if (!actor.vendor_id) throw new HttpError(403, 'VENDOR_REQUIRED', 'Vendor context is required.');
      const vendorId = actor.vendor_id;
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          `SELECT a.*, m.historical_label as actor_label, m.role as actor_role
           FROM invoice_actions a
           JOIN memberships m ON a.actor_membership_id=m.id
           WHERE a.invoice_id=$1 AND a.vendor_id=$2
           ORDER BY a.created_at ASC`,
          [id, vendorId]
        )).rows;
      });
    },
  };
}
