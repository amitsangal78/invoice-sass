import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { calculateCollectible, calculateOutstanding, policy, roundMoney } from '@invoice/contracts';
import { type Database, transaction, withTenant, withCapability } from '@invoice/database';
import { seal, secretHmac, tokenHash, unseal } from '@invoice/database/crypto';
import type { Config } from '../config';
import { createProviderAttempt,checkoutData } from '../integrations/paymentAttempts';
import { HttpError } from '../errors';

export function customerAccessService(db: Database, config: Config) {
  return {
    async inspectLink(linkToken: string) {
      const hash = tokenHash(linkToken);
      return withCapability(db, 'link', hash, async client => {
      const link = (await client.query(
        `SELECT l.*, i.document_state, v.status as vendor_status
         FROM invoice_access_links l
         JOIN invoices i ON l.invoice_id=i.id
         JOIN vendors v ON l.vendor_id=v.id
         WHERE l.token_hash=$1`,
        [hash]
      )).rows[0];

      if (!link || link.revoked_at || link.vendor_status === 'BLOCKED' || link.document_state === 'CANCELLED') {
        return { status: 'UNAVAILABLE' };
      }
      if (new Date() >= new Date(link.expires_at)) {
        return { status: 'EXPIRED' };
      }
      return { status: 'VALID' };
      });
    },

    async requestOtp(linkToken: string) {
      const hash = tokenHash(linkToken);
      return withCapability(db, 'link', hash, async client => {
        const link = (await client.query(
          `SELECT l.*, i.document_state, v.status as vendor_status
           FROM invoice_access_links l
           JOIN invoices i ON l.invoice_id=i.id
           JOIN vendors v ON l.vendor_id=v.id
           WHERE l.token_hash=$1 FOR UPDATE`,
          [hash]
        )).rows[0];

        if (!link || link.revoked_at || link.vendor_status === 'BLOCKED' || link.document_state === 'CANCELLED') {
          throw new HttpError(404, 'LINK_UNAVAILABLE', 'This invoice link is no longer available.');
        }
        if (new Date() >= new Date(link.expires_at)) {
          throw new HttpError(410, 'LINK_EXPIRED', 'This invoice link has expired. Please request a new link.');
        }

        const emailData = unseal(link.destination_email_ciphertext, config.DELIVERY_KEY) as { email: string };
        const id = randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');

        await client.query(
          'UPDATE otp_challenges SET invalidated_at=now() WHERE access_link_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL',
          [link.id]
        );

        await client.query(
          `INSERT INTO otp_challenges(id,access_link_id,purpose,code_hmac,destination_ciphertext,scope_key,expires_at)
           VALUES($1,$2,'CUSTOMER_INVOICE',$3,$4,$5,now()+interval '5 minutes')`,
          [id, link.id, secretHmac(config.OTP_SECRET, `${id}:${code}`), link.destination_email_ciphertext, `customer:${link.id}`]
        );

        await client.query(
          "INSERT INTO outbox_jobs(kind,business_key,payload,encrypted_payload) VALUES('OTP',$1,$2,$3)",
          [
            `customer-otp:${id}`,
            JSON.stringify({ challenge_id: id, purpose: 'CUSTOMER_INVOICE', link_id: link.id }),
            seal({ to: emailData.email, code, purpose: 'CUSTOMER_INVOICE', expires_at: new Date(Date.now() + policy.otpMs).toISOString() }, config.DELIVERY_KEY),
          ]
        );

        return { challenge_id: id, expires_in_seconds: 300, resend_after_seconds: 60 };
      });
    },

    async verifyOtp(linkToken: string, challengeId: string, code: string) {
      const hash = tokenHash(linkToken);
      const result = await withCapability(db, 'link', hash, async client => {
        const link = (await client.query(
          `SELECT l.*, v.status as vendor_status, i.document_state
           FROM invoice_access_links l
           JOIN vendors v ON l.vendor_id=v.id
           JOIN invoices i ON l.invoice_id=i.id
           WHERE l.token_hash=$1 FOR UPDATE`,
          [hash]
        )).rows[0];

        if (!link || link.revoked_at || link.vendor_status === 'BLOCKED' || link.document_state === 'CANCELLED') {
          throw new HttpError(404, 'LINK_UNAVAILABLE', 'This invoice link is no longer available.');
        }
        if (new Date() >= new Date(link.expires_at)) {
          throw new HttpError(410, 'LINK_EXPIRED', 'This invoice link has expired.');
        }

        const challenge = (await client.query(
          'SELECT * FROM otp_challenges WHERE id=$1 AND access_link_id=$2 FOR UPDATE',
          [challengeId, link.id]
        )).rows[0];

        if (!challenge || challenge.consumed_at || challenge.invalidated_at || new Date() >= new Date(challenge.expires_at) || challenge.attempts >= 5) {
          throw new HttpError(401, 'OTP_INVALID', 'The code is invalid or expired.');
        }

        if (!timingSafeEqual(challenge.code_hmac, secretHmac(config.OTP_SECRET, `${challengeId}:${code}`))) {
          await client.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [challengeId]);
          return new HttpError(401, 'OTP_INVALID', 'The code is invalid.');
        }

        await client.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [challengeId]);

        // Create 15-minute customer session
        const sessionToken = randomBytes(32).toString('base64url');
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + policy.customerSessionMs);

        await client.query(
          `INSERT INTO customer_sessions(id,vendor_id,invoice_id,access_link_id,otp_challenge_id,token_hash,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [sessionId, link.vendor_id, link.invoice_id, link.id, challengeId, tokenHash(sessionToken), expiresAt]
        );

        return { session_token: sessionToken, expires_at: expiresAt.toISOString() };
      });
      if (result instanceof HttpError) throw result;
      return result;
    },

    async renewLink(linkToken: string) {
      const hash = tokenHash(linkToken);
      return withCapability(db, 'link', hash, async client => {
        const link = (await client.query(
          `SELECT l.*, v.status as vendor_status, i.document_state, i.invoice_number
           FROM invoice_access_links l
           JOIN vendors v ON l.vendor_id=v.id
           JOIN invoices i ON l.invoice_id=i.id
           WHERE l.token_hash=$1 FOR UPDATE`,
          [hash]
        )).rows[0];

        if (!link || link.vendor_status === 'BLOCKED' || link.document_state === 'CANCELLED') {
          throw new HttpError(404, 'LINK_UNAVAILABLE', 'This invoice link is no longer available.');
        }

        // Revoke old link and existing sessions
        await client.query('UPDATE invoice_access_links SET revoked_at=now() WHERE id=$1', [link.id]);
        await client.query('UPDATE customer_sessions SET revoked_at=now() WHERE access_link_id=$1', [link.id]);

        // Issue fresh 5-day link
        const newLinkToken = randomBytes(32).toString('base64url');
        const newLinkId = randomUUID();
        await client.query(
          `INSERT INTO invoice_access_links(id,vendor_id,invoice_id,token_hash,destination_email_ciphertext,issued_at,expires_at,replaces_link_id)
           VALUES($1,$2,$3,$4,$5,now(),now()+interval '5 days',$6)`,
          [newLinkId, link.vendor_id, link.invoice_id, tokenHash(newLinkToken), link.destination_email_ciphertext, link.id]
        );

        const emailData = unseal(link.destination_email_ciphertext, config.DELIVERY_KEY) as { email: string };
        await client.query(
          `INSERT INTO outbox_jobs(kind,business_key,payload,encrypted_payload)
           VALUES('EMAIL',$1,$2,$3)`,
          [
            `email:link-renewal:${newLinkId}`,
            JSON.stringify({ kind: 'LINK_RENEWAL', invoice_id: link.invoice_id, link_id: newLinkId }),
            seal({ to: emailData.email, invoice_number: link.invoice_number, link_token: newLinkToken }, config.DELIVERY_KEY),
          ]
        );

        return { status: 'ACCEPTED' };
      });
    },

    async authenticateSession(sessionToken: string) {
      const hash = tokenHash(sessionToken);
      return withCapability(db, 'customer', hash, async client => {
      const session = (await client.query(
        `SELECT cs.*, l.revoked_at as link_revoked_at, l.expires_at as link_expires_at,
                v.status as vendor_status, i.document_state
         FROM customer_sessions cs
         JOIN invoice_access_links l ON cs.access_link_id=l.id
         JOIN vendors v ON cs.vendor_id=v.id
         JOIN invoices i ON cs.invoice_id=i.id
         WHERE cs.token_hash=$1 AND cs.revoked_at IS NULL AND cs.expires_at>now()`,
        [hash]
      )).rows[0];

      if (!session || session.link_revoked_at || session.vendor_status === 'BLOCKED' || session.document_state === 'CANCELLED') {
        throw new HttpError(401, 'CUSTOMER_SESSION_EXPIRED', 'Customer session is expired or revoked.');
      }
      return {
        vendor_id: session.vendor_id as string,
        invoice_id: session.invoice_id as string,
        session_id: session.id as string,
      };
      });
    },

    async getCustomerInvoice(vendorId: string, invoiceId: string) {
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query(
          `SELECT i.id,i.invoice_number,i.invoice_date,i.due_date,i.currency,i.subtotal,
                  i.discount_total,i.tax_total,i.rounding_adjustment,i.total,i.seller_snapshot,
                  i.customer_snapshot,i.document_state,i.document_options,
                  coalesce((SELECT sum(amount) FROM payment_allocations pa WHERE pa.invoice_id=i.id AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)), 0) as allocated_amount,
                  coalesce((SELECT sum(amount) FROM credit_notes cn WHERE cn.invoice_id=i.id AND cn.status='ISSUED' AND cn.invoice_revision_id IS NULL), 0) as standalone_credit_amount
           FROM invoices i
           WHERE i.id=$1 AND i.vendor_id=$2`,
          [invoiceId, vendorId]
        )).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');

        const lines = (await client.query('SELECT line_no,description,unit,quantity,unit_price,discount_amount,taxable_amount,tax_amount,line_total FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no ASC', [invoiceId])).rows;
        const collectible = calculateCollectible(Number(inv.total), Number(inv.standalone_credit_amount));
        const outstanding = calculateOutstanding(collectible, Number(inv.allocated_amount));

        return {
          ...inv,
          payment_options:{driver:config.PAYMENT_DRIVER??'razorpay',configured:config.PAYMENT_DRIVER==='simulation'||Boolean(config.RAZORPAY_KEY_ID&&config.RAZORPAY_KEY_SECRET)},
          lines,
          collectible_amount: collectible,
          outstanding_amount: outstanding,
          paid: outstanding === 0,
          can_pay: outstanding > 0 && inv.document_state === 'ISSUED',
        };
      });
    },

    async createPaymentAttempt(vendorId: string, invoiceId: string, amount: number, method: 'CHECKOUT_UPI' | 'PROVIDER_QR', requestKey?:string) {
      return createProviderAttempt(db,config,vendorId,invoiceId,undefined,amount,method,requestKey);
    },

    async getPaymentAttempt(vendorId: string, invoiceId: string, attemptId: string) {
      return withTenant(db, vendorId, async client => {
        const row = (await client.query(
          'SELECT * FROM payment_attempts WHERE id=$1 AND invoice_id=$2 AND vendor_id=$3',
          [attemptId, invoiceId, vendorId]
        )).rows[0];
        if (!row) throw new HttpError(404, 'ATTEMPT_NOT_FOUND', 'Payment attempt not found.');
        return checkoutData(row,config);
      });
    },

    async getScopedPayments(vendorId: string, invoiceId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          `SELECT pa.id as allocation_id, pa.amount, pa.created_at as allocated_at,
                  p.id as payment_id, p.received_at, p.method, r.number as receipt_number
           FROM payment_allocations pa
           JOIN payments p ON pa.payment_id=p.id
           LEFT JOIN receipts r ON r.payment_id=p.id
           WHERE pa.invoice_id=$1 AND pa.vendor_id=$2
             AND pa.id NOT IN (SELECT allocation_id FROM allocation_reversals)
           ORDER BY pa.created_at ASC`,
          [invoiceId, vendorId]
        )).rows;
      });
    },

    async getCustomerDocuments(vendorId: string, invoiceId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          `SELECT id, kind, mime_type, status, created_at,certificate_number
           FROM documents
           WHERE invoice_id=$1 AND vendor_id=$2 AND status='READY' AND (kind NOT IN ('INVOICE_PDF','COURSE_CERTIFICATE') OR invoice_revision_id=(SELECT r.id FROM invoice_revisions r JOIN invoices i ON i.id=r.invoice_id WHERE i.id=$1 AND r.revision_no=i.current_revision_no))
           ORDER BY created_at DESC`,
          [invoiceId, vendorId]
        )).rows;
      });
    },

    async logoutCustomer(sessionToken: string) {
      await withCapability(db, 'customer', tokenHash(sessionToken), client => client.query('UPDATE customer_sessions SET revoked_at=now() WHERE token_hash=$1', [tokenHash(sessionToken)]));
    },
  };
}
