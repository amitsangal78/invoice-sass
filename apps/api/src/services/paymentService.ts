import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { calculateCollectible, calculateOutstanding, roundMoney } from '@invoice/contracts';
import { type Database, transaction, withTenant } from '@invoice/database';
import { seal } from '@invoice/database/crypto';
import type { Config } from '../config';
import { createProviderAttempt,checkoutData } from '../integrations/paymentAttempts';
import { razorpayClient,validSignature } from '../integrations/razorpay';
import { applyPaymentEvent,eventFingerprint } from '../integrations/paymentEvents';
import { HttpError } from '../errors';

export function paymentService(db: Database, config: Config) {
  return {
    async listPayments(vendorId: string, filters?: { customer_id?: string; from?: string; to?: string }) {
      return withTenant(db, vendorId, async client => {
        let sql = `
          SELECT p.*, c.name as customer_name,
                 coalesce((SELECT sum(amount) FROM payment_allocations pa WHERE pa.payment_id=p.id AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)), 0) as allocated_amount,
                 coalesce((SELECT sum(amount) FROM funds_adjustments fa WHERE fa.payment_id=p.id AND fa.kind='CHARGEBACK_DEBIT'), 0) as chargeback_amount,
                 (SELECT count(*) FROM payment_reversals pr WHERE pr.payment_id=p.id) as is_reversed
          FROM payments p
          JOIN customers c ON p.customer_id=c.id
          WHERE p.vendor_id=$1
        `;
        const params: any[] = [vendorId];
        if (filters?.customer_id) {
          params.push(filters.customer_id);
          sql += ` AND p.customer_id=$${params.length}`;
        }
        sql += ' ORDER BY p.received_at DESC';
        const rows = (await client.query(sql, params)).rows;
        return rows.map(r => {
          const remainingFunds = Number(r.is_reversed) > 0 ? 0 : Math.max(0, roundMoney(Number(r.amount) - Number(r.chargeback_amount)));
          const availableCredit = Math.max(0, roundMoney(remainingFunds - Number(r.allocated_amount)));
          return {
            ...r,
            remaining_funds: remainingFunds,
            available_credit: availableCredit,
          };
        });
      });
    },

    async getPayment(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const p = (await client.query(
          `SELECT p.*, c.name as customer_name,
                  coalesce((SELECT sum(amount) FROM funds_adjustments fa WHERE fa.payment_id=p.id AND fa.kind='CHARGEBACK_DEBIT'), 0) as chargeback_amount,
                  (SELECT count(*) FROM payment_reversals pr WHERE pr.payment_id=p.id) as is_reversed
           FROM payments p
           JOIN customers c ON p.customer_id=c.id
           WHERE p.id=$1 AND p.vendor_id=$2`,
          [id, vendorId]
        )).rows[0];
        if (!p) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');

        const allocations = (await client.query(
          `SELECT pa.*, i.invoice_number,
                  (SELECT count(*) FROM allocation_reversals ar WHERE ar.allocation_id=pa.id) as is_reversed
           FROM payment_allocations pa
           JOIN invoices i ON pa.invoice_id=i.id
           WHERE pa.payment_id=$1 ORDER BY pa.created_at ASC`,
          [id]
        )).rows;

        const activeAllocationsSum = allocations
          .filter(a => Number(a.is_reversed) === 0)
          .reduce((acc, a) => acc + Number(a.amount), 0);

        const remainingFunds = Number(p.is_reversed) > 0 ? 0 : Math.max(0, roundMoney(Number(p.amount) - Number(p.chargeback_amount)));
        const availableCredit = Math.max(0, roundMoney(remainingFunds - activeAllocationsSum));

        return {
          ...p,
          allocations,
          remaining_funds: remainingFunds,
          available_credit: availableCredit,
        };
      });
    },

    async listPaymentAttempts(vendorId: string, filters?: { invoice_id?: string; status?: string }) {
      return withTenant(db, vendorId, async client => {
        let sql = 'SELECT * FROM payment_attempts WHERE vendor_id=$1';
        const params: any[] = [vendorId];
        if (filters?.invoice_id) {
          params.push(filters.invoice_id);
          sql += ` AND invoice_id=$${params.length}`;
        }
        if (filters?.status) {
          params.push(filters.status);
          sql += ` AND status=$${params.length}`;
        }
        sql += ' ORDER BY created_at DESC';
        return (await client.query(sql, params)).rows;
      });
    },

    async createAdvanceAttempt(vendorId: string, customerId: string, amount: number, method: 'CHECKOUT_UPI' | 'PROVIDER_QR') {
      return createProviderAttempt(db,config,vendorId,null,customerId,amount,method);
    },

    async recordManualPayment(vendorId: string, actorMembershipId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const paymentId = randomUUID();
        const receivedAt = input.received_at ? new Date(input.received_at) : new Date();

        const payment = (await client.query(
          `INSERT INTO payments(
             id,vendor_id,customer_id,source,method,amount,currency,received_at,recorded_by_membership_id,reference
           )
           VALUES($1,$2,$3,'MANUAL_TEST',$4,$5,'INR',$6,$7,$8) RETURNING *`,
          [paymentId, vendorId, input.customer_id, input.method, input.amount, receivedAt, actorMembershipId, input.reference ?? null]
        )).rows[0];

        const allocations: any[] = [];
        if (input.invoice_id) {
          const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [input.invoice_id, vendorId])).rows[0];
          if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
          const allocId = randomUUID();
          await client.query(
            `INSERT INTO payment_allocations(id,vendor_id,customer_id,payment_id,invoice_id,amount,actor_membership_id)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [allocId, vendorId, input.customer_id, paymentId, input.invoice_id, input.amount, actorMembershipId]
          );
          allocations.push({ invoice_id: input.invoice_id, amount: input.amount });
        }

        // Generate receipt
        const year = new Date().getFullYear();
        let seqRow = (await client.query(
          "SELECT * FROM document_sequences WHERE vendor_id=$1 AND kind='RECEIPT' AND series=$2 FOR UPDATE",
          [vendorId, `${year}`]
        )).rows[0];
        if (!seqRow) {
          seqRow = (await client.query(
            "INSERT INTO document_sequences(id,vendor_id,kind,series,next_value) VALUES($1,$2,'RECEIPT',$3,1) RETURNING *",
            [randomUUID(), vendorId, `${year}`]
          )).rows[0];
        }
        const receiptNo = `REC-${year}-${String(seqRow.next_value).padStart(4, '0')}`;
        await client.query('UPDATE document_sequences SET next_value=next_value+1 WHERE id=$1', [seqRow.id]);

        await client.query(
          `INSERT INTO receipts(id,vendor_id,payment_id,number,amount_snapshot,allocation_snapshot)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), vendorId, paymentId, receiptNo, input.amount, JSON.stringify(allocations)]
        );

        return payment;
      });
    },

    async allocatePayment(vendorId: string, actorMembershipId: string, paymentId: string, allocationItems: { invoice_id: string; amount: number }[]) {
      return withTenant(db, vendorId, async client => {
        const payment = (await client.query('SELECT * FROM payments WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [paymentId, vendorId])).rows[0];
        if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');

        const activeAllocationsSum = Number((await client.query(
          'SELECT coalesce(sum(amount),0) as sum FROM payment_allocations WHERE payment_id=$1 AND id NOT IN (SELECT allocation_id FROM allocation_reversals)',
          [paymentId]
        )).rows[0].sum);

        const available = roundMoney(Number(payment.amount) - activeAllocationsSum);
        const requestTotal = allocationItems.reduce((acc, a) => acc + a.amount, 0);
        if (requestTotal > available) {
          throw new HttpError(400, 'EXCEEDS_AVAILABLE_FUNDS', `Total allocation (${requestTotal}) exceeds available funds (${available}).`);
        }

        const created: any[] = [];
        for (const item of allocationItems) {
          const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [item.invoice_id, vendorId])).rows[0];
          if (!inv || inv.customer_id !== payment.customer_id) {
            throw new HttpError(400, 'INVALID_INVOICE', `Invoice ${item.invoice_id} is not valid for this customer.`);
          }
          const allocId = randomUUID();
          await client.query(
            `INSERT INTO payment_allocations(id,vendor_id,customer_id,payment_id,invoice_id,amount,actor_membership_id)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [allocId, vendorId, payment.customer_id, paymentId, item.invoice_id, item.amount, actorMembershipId]
          );
          created.push({ id: allocId, invoice_id: item.invoice_id, amount: item.amount });
        }
        return { payment_id: paymentId, allocated: created };
      });
    },

    async reverseAllocation(vendorId: string, actorMembershipId: string, allocationId: string, reason: string, replacementAllocations?: { invoice_id: string; amount: number }[]) {
      return withTenant(db, vendorId, async client => {
        const alloc = (await client.query('SELECT * FROM payment_allocations WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [allocationId, vendorId])).rows[0];
        if (!alloc) throw new HttpError(404, 'ALLOCATION_NOT_FOUND', 'Allocation not found.');

        const alreadyReversed = Number((await client.query('SELECT 1 FROM allocation_reversals WHERE allocation_id=$1', [allocationId])).rowCount ?? 0) > 0;
        if (alreadyReversed) throw new HttpError(400, 'ALREADY_REVERSED', 'Allocation was already reversed.');

        await client.query(
          `INSERT INTO allocation_reversals(id,vendor_id,allocation_id,amount,reason,actor_membership_id)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), vendorId, allocationId, alloc.amount, reason, actorMembershipId]
        );

        const replacements: any[] = [];
        if (replacementAllocations) {
          for (const rep of replacementAllocations) {
            const repId = randomUUID();
            await client.query(
              `INSERT INTO payment_allocations(id,vendor_id,customer_id,payment_id,invoice_id,amount,actor_membership_id)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [repId, vendorId, alloc.customer_id, alloc.payment_id, rep.invoice_id, rep.amount, actorMembershipId]
            );
            replacements.push({ id: repId, invoice_id: rep.invoice_id, amount: rep.amount });
          }
        }
        return { reversed_allocation_id: allocationId, replacements };
      });
    },

    async reverseManualPayment(vendorId: string, actorMembershipId: string, paymentId: string, reason: string) {
      return withTenant(db, vendorId, async client => {
        const payment = (await client.query('SELECT * FROM payments WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [paymentId, vendorId])).rows[0];
        if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
        if (payment.source !== 'MANUAL_TEST') {
          throw new HttpError(400, 'CANNOT_REVERSE_PROVIDER_PAYMENT', 'Only manually entered payments can be reversed.');
        }

        const activeAllocations = (await client.query(
          'SELECT * FROM payment_allocations WHERE payment_id=$1 AND id NOT IN (SELECT allocation_id FROM allocation_reversals)',
          [paymentId]
        )).rows;

        for (const a of activeAllocations) {
          await client.query(
            `INSERT INTO allocation_reversals(id,vendor_id,allocation_id,amount,reason,actor_membership_id)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), vendorId, a.id, a.amount, `Reversed along with manual payment reversal: ${reason}`, actorMembershipId]
          );
        }

        await client.query(
          `INSERT INTO payment_reversals(id,vendor_id,payment_id,actor_membership_id,reason)
           VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), vendorId, paymentId, actorMembershipId, reason]
        );

        // Void receipt if exists
        await client.query('UPDATE receipts SET voided_at=now(),void_reason=$2 WHERE payment_id=$1', [paymentId, reason]);

        return { payment_id: paymentId, reversed: true };
      });
    },

    // Credit notes
    async createCreditNote(vendorId: string, membershipId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT * FROM invoices WHERE id=$1 AND vendor_id=$2', [input.invoice_id, vendorId])).rows[0];
        if (!inv || inv.document_state !== 'ISSUED') throw new HttpError(400, 'INVALID_INVOICE', 'Invoice must be issued.');

        const id = randomUUID();
        const row = (await client.query(
          `INSERT INTO credit_notes(id,vendor_id,customer_id,invoice_id,status,amount,reason,created_by_membership_id)
           VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7) RETURNING *`,
          [id, vendorId, inv.customer_id, input.invoice_id, input.amount, input.reason, membershipId]
        )).rows[0];
        return row;
      });
    },

    async issueCreditNote(vendorId: string, membershipId: string, id: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const cn = (await client.query('SELECT * FROM credit_notes WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!cn) throw new HttpError(404, 'CREDIT_NOTE_NOT_FOUND', 'Credit note not found.');
        if (cn.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Version mismatch.');
        if (cn.status === 'ISSUED') throw new HttpError(400, 'ALREADY_ISSUED', 'Credit note is already issued.');

        const year = new Date().getFullYear();
        let seqRow = (await client.query(
          "SELECT * FROM document_sequences WHERE vendor_id=$1 AND kind='CREDIT_NOTE' AND series=$2 FOR UPDATE",
          [vendorId, `${year}`]
        )).rows[0];
        if (!seqRow) {
          seqRow = (await client.query(
            "INSERT INTO document_sequences(id,vendor_id,kind,series,next_value) VALUES($1,$2,'CREDIT_NOTE',$3,1) RETURNING *",
            [randomUUID(), vendorId, `${year}`]
          )).rows[0];
        }
        const cnNo = `CN-${year}-${String(seqRow.next_value).padStart(4, '0')}`;
        await client.query('UPDATE document_sequences SET next_value=next_value+1 WHERE id=$1', [seqRow.id]);

        await client.query(
          "UPDATE credit_notes SET status='ISSUED',number=$2,issued_at=now(),version=version+1 WHERE id=$1",
          [id, cnNo]
        );

        return (await client.query('SELECT * FROM credit_notes WHERE id=$1', [id])).rows[0];
      });
    },

    async listCreditNotes(vendorId: string, filters?: { invoice_id?: string; status?: string }) {
      return withTenant(db, vendorId, async client => {
        let sql = 'SELECT * FROM credit_notes WHERE vendor_id=$1';
        const params: any[] = [vendorId];
        if (filters?.invoice_id) {
          params.push(filters.invoice_id);
          sql += ` AND invoice_id=$${params.length}`;
        }
        if (filters?.status) {
          params.push(filters.status);
          sql += ` AND status=$${params.length}`;
        }
        sql += ' ORDER BY created_at DESC';
        return (await client.query(sql, params)).rows;
      });
    },

    async getCreditNote(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const cn = (await client.query('SELECT * FROM credit_notes WHERE id=$1 AND vendor_id=$2', [id, vendorId])).rows[0];
        if (!cn) throw new HttpError(404, 'CREDIT_NOTE_NOT_FOUND', 'Credit note not found.');
        return cn;
      });
    },

    // Disputes
    async listDisputes(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM disputes WHERE vendor_id=$1 ORDER BY opened_at DESC', [vendorId])).rows;
      });
    },

    async getDispute(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const d = (await client.query('SELECT * FROM disputes WHERE id=$1 AND vendor_id=$2', [id, vendorId])).rows[0];
        if (!d) throw new HttpError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found.');
        return d;
      });
    },

    // Receipts
    async listReceipts(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM receipts WHERE vendor_id=$1 ORDER BY issued_at DESC', [vendorId])).rows;
      });
    },

    async getReceipt(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const r = (await client.query('SELECT * FROM receipts WHERE id=$1 AND vendor_id=$2', [id, vendorId])).rows[0];
        if (!r) throw new HttpError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
        return r;
      });
    },

    // Reconciliation
    async listReconciliationCases(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM reconciliation_cases WHERE vendor_id=$1 ORDER BY created_at DESC', [vendorId])).rows;
      });
    },

    async resolveReconciliationCase(vendorId: string, membershipId: string, id: string, resolution: string) {
      return withTenant(db, vendorId, async client => {
        const c = (await client.query('SELECT * FROM reconciliation_cases WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!c) throw new HttpError(404, 'CASE_NOT_FOUND', 'Reconciliation case not found.');
        await client.query(
          "UPDATE reconciliation_cases SET status='RESOLVED',resolved_by_membership_id=$2,resolved_at=now(),resolution=$3 WHERE id=$1",
          [id, membershipId, resolution]
        );
        return (await client.query('SELECT * FROM reconciliation_cases WHERE id=$1', [id])).rows[0];
      });
    },

    async simulateCustomerPayment(vendorId:string,invoiceId:string,attemptId:string){
      if(config.NODE_ENV==='production'||config.PAYMENT_DRIVER!=='simulation')throw new HttpError(403,'SIMULATION_DISABLED','Simulation is not enabled.');
      const attempt=await withTenant(db,vendorId,async client=>(await client.query("SELECT * FROM payment_attempts WHERE id=$1 AND invoice_id=$2 AND driver='simulation'",[attemptId,invoiceId])).rows[0]);
      if(!attempt)throw new HttpError(404,'ATTEMPT_NOT_FOUND','Payment attempt not found.');
      return applyPaymentEvent(db,config,{event:'payment.captured',payload:{payment:{entity:{id:`pay_sim_${attempt.id}`,order_id:attempt.external_order_id,amount:Math.round(Number(attempt.requested_amount)*100),currency:'INR',status:'captured',method:'upi'}}}},`simulation:${attempt.id}`,{vendorId,invoiceId,attemptId});
    },

    async verifyCustomerCheckout(vendorId:string,invoiceId:string,attemptId:string,input:{provider_order_id?:string;provider_payment_id?:string;provider_signature?:string}){
      const attempt=await withTenant(db,vendorId,async client=>(await client.query('SELECT * FROM payment_attempts WHERE id=$1 AND invoice_id=$2',[attemptId,invoiceId])).rows[0]);
      if(!attempt)throw new HttpError(404,'ATTEMPT_NOT_FOUND','Payment attempt not found.');
      if(attempt.driver!=='razorpay')throw new HttpError(400,'WRONG_PAYMENT_DRIVER','Use the configured payment flow.');
      if(!input.provider_payment_id||!input.provider_signature||input.provider_order_id!==attempt.external_order_id||!config.RAZORPAY_KEY_SECRET||!validSignature(`${attempt.external_order_id}|${input.provider_payment_id}`,input.provider_signature,config.RAZORPAY_KEY_SECRET))throw new HttpError(401,'CHECKOUT_SIGNATURE_INVALID','Payment verification failed.');
      const payment=await razorpayClient(config).getPayment(input.provider_payment_id);
      if(payment.order_id!==attempt.external_order_id||payment.currency!=='INR'||payment.amount!==Math.round(Number(attempt.requested_amount)*100))throw new HttpError(422,'PAYMENT_DETAILS_MISMATCH','Payment details do not match this attempt.');
      if(payment.status==='captured'||payment.status==='authorized'||payment.status==='failed')await applyPaymentEvent(db,config,{event:`payment.${payment.status}`,payload:{payment:{entity:payment}}},`verification:${payment.id}:${payment.status}`,{vendorId,invoiceId,attemptId});
      return this.reconcileCustomerPayment(vendorId,invoiceId,attemptId,false);
    },

    async reconcileCustomerPayment(vendorId:string,invoiceId:string|null,attemptId:string,fetchProvider=true){
      let attempt=await withTenant(db,vendorId,async client=>(await client.query('SELECT * FROM payment_attempts WHERE id=$1 AND invoice_id IS NOT DISTINCT FROM $2',[attemptId,invoiceId])).rows[0]);
      if(!attempt)throw new HttpError(404,'ATTEMPT_NOT_FOUND','Payment attempt not found.');
      if(attempt.driver==='razorpay'&&fetchProvider&&attempt.status!=='SUCCEEDED'){
        const provider=razorpayClient(config);
        if(!attempt.external_order_id){
          const orders=await provider.findOrders(attempt.provider_receipt);
          const matches=orders.items.filter(o=>o.receipt===attempt.provider_receipt&&o.amount===Math.round(Number(attempt.requested_amount)*100)&&o.currency==='INR');
          if(matches.length===1){
            const order=matches[0]!;
            attempt=await withTenant(db,vendorId,async client=>(await client.query("UPDATE payment_attempts SET external_order_id=$2,status='PENDING',last_error_code=NULL WHERE id=$1 AND status<>'SUCCEEDED' RETURNING *",[attempt.id,order.id])).rows[0]??attempt);
          }else if(matches.length>1)throw new HttpError(409,'ORDER_REQUIRES_REVIEW','Multiple provider orders require platform review.');
        }
        if(attempt.external_order_id){
          const payments=await provider.getOrderPayments(attempt.external_order_id);
          for(const payment of payments.items){
            if(!['captured','authorized','failed'].includes(payment.status))continue;
            await applyPaymentEvent(db,config,{event:`payment.${payment.status}`,payload:{payment:{entity:payment}}},`verification:${payment.id}:${payment.status}`,{vendorId,invoiceId,attemptId});
          }
        }
      }
      attempt=await withTenant(db,vendorId,async client=>(await client.query('SELECT * FROM payment_attempts WHERE id=$1',[attemptId])).rows[0]);
      return checkoutData(attempt,config);
    },

    async handleRazorpayWebhook(rawBody:string,signature:string,_unused?:undefined,eventIdHeader?:string){
      if(!config.RAZORPAY_WEBHOOK_SECRET)throw new HttpError(503,'WEBHOOK_NOT_CONFIGURED','Razorpay webhook secret has not been configured.');
      if(!validSignature(rawBody,signature,config.RAZORPAY_WEBHOOK_SECRET))throw new HttpError(401,'WEBHOOK_SIGNATURE_INVALID','Invalid webhook signature.');
      let payload:any;try{payload=JSON.parse(rawBody);}catch{throw new HttpError(400,'MALFORMED_REQUEST','Invalid webhook JSON.');}
      return applyPaymentEvent(db,config,payload,eventIdHeader??payload.event_id??eventFingerprint(rawBody));
    },
  };
}
