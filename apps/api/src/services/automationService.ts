import { randomUUID } from 'node:crypto';
import { roundMoney } from '@invoice/contracts';
import { type Database, withTenant, withPlatformOwner } from '@invoice/database';
import type { Config } from '../config';
import { unseal } from '@invoice/database/crypto';
import { applyPaymentEvent } from '../integrations/paymentEvents';
import { HttpError } from '../errors';

export function automationService(db: Database, config: Config) {
  return {
    // Recurring schedules
    async listRecurringSchedules(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          `SELECT rs.*, c.name as customer_name
           FROM recurring_schedules rs
           JOIN customers c ON rs.customer_id=c.id
           WHERE rs.vendor_id=$1
           ORDER BY rs.created_at DESC`,
          [vendorId]
        )).rows;
      });
    },

    async createRecurringSchedule(vendorId: string, membershipId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const id = randomUUID();
        const nextDue = new Date();
        if (input.frequency === 'WEEKLY') nextDue.setDate(nextDue.getDate() + 7 * (input.interval_count ?? 1));
        else nextDue.setMonth(nextDue.getMonth() + 1 * (input.interval_count ?? 1));

        return (await client.query(
          `INSERT INTO recurring_schedules(
             id,vendor_id,customer_id,owner_membership_id,frequency,interval_count,next_due_at,template
           )
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            id,
            vendorId,
            input.customer_id,
            membershipId,
            input.frequency,
            input.interval_count ?? 1,
            nextDue,
            JSON.stringify(input.template ?? {}),
          ]
        )).rows[0];
      });
    },

    async getRecurringSchedule(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const row = (await client.query('SELECT * FROM recurring_schedules WHERE id=$1 AND vendor_id=$2', [id, vendorId])).rows[0];
        if (!row) throw new HttpError(404, 'SCHEDULE_NOT_FOUND', 'Recurring schedule not found.');
        return row;
      });
    },

    async patchRecurringSchedule(vendorId: string, id: string, patch: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM recurring_schedules WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'SCHEDULE_NOT_FOUND', 'Recurring schedule not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Version mismatch.');

        return (await client.query(
          `UPDATE recurring_schedules SET
             active=coalesce($3,active),
             frequency=coalesce($4,frequency),
             interval_count=coalesce($5,interval_count),
             template=case when $6::jsonb is not null then $6::jsonb else template end,
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [id, vendorId, patch.active, patch.frequency, patch.interval_count, patch.template ? JSON.stringify(patch.template) : null]
        )).rows[0];
      });
    },

    async listOccurrences(vendorId: string, scheduleId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          'SELECT * FROM recurring_occurrences WHERE schedule_id=$1 AND vendor_id=$2 ORDER BY scheduled_for DESC',
          [scheduleId, vendorId]
        )).rows;
      });
    },

    // Reminder rules
    async listReminderRules(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM reminder_rules WHERE vendor_id=$1 ORDER BY offset_days ASC', [vendorId])).rows;
      });
    },

    async createReminderRule(vendorId: string, offsetDays: number, active = true) {
      return withTenant(db, vendorId, async client => {
        const id = randomUUID();
        return (await client.query(
          'INSERT INTO reminder_rules(id,vendor_id,offset_days,active) VALUES($1,$2,$3,$4) RETURNING *',
          [id, vendorId, offsetDays, active]
        )).rows[0];
      });
    },

    async patchReminderRule(vendorId: string, id: string, patch: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM reminder_rules WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'RULE_NOT_FOUND', 'Reminder rule not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Version mismatch.');

        return (await client.query(
          `UPDATE reminder_rules SET
             offset_days=coalesce($3,offset_days),
             active=coalesce($4,active),
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [id, vendorId, patch.offset_days, patch.active]
        )).rows[0];
      });
    },

    async pauseInvoiceReminders(vendorId: string, invoiceId: string, paused: boolean, version: number) {
      return withTenant(db, vendorId, async client => {
        const inv = (await client.query('SELECT version FROM invoices WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [invoiceId, vendorId])).rows[0];
        if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        if (inv.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Version mismatch.');

        return (await client.query(
          'UPDATE invoices SET reminders_paused=$3,version=version+1 WHERE id=$1 AND vendor_id=$2 RETURNING *',
          [invoiceId, vendorId, paused]
        )).rows[0];
      });
    },

    async listInvoiceDeliveries(vendorId: string, invoiceId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          'SELECT * FROM reminder_deliveries WHERE invoice_id=$1 AND vendor_id=$2 ORDER BY scheduled_for DESC',
          [invoiceId, vendorId]
        )).rows;
      });
    },

    // Dashboards & Reports
    async getOwnerDashboard(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        const approvalsCount = Number((await client.query(
          "SELECT count(*) FROM invoices WHERE vendor_id=$1 AND approval_state='SUBMITTED'",
          [vendorId]
        )).rows[0].count);

        const invoicedTotal = Number((await client.query(
          "SELECT coalesce(sum(total),0) as sum FROM invoices WHERE vendor_id=$1 AND document_state='ISSUED'",
          [vendorId]
        )).rows[0].sum);

        const collectedTotal = Number((await client.query(
          'SELECT coalesce(sum(amount),0) as sum FROM payments WHERE vendor_id=$1 AND id NOT IN (SELECT payment_id FROM payment_reversals)',
          [vendorId]
        )).rows[0].sum);

        const allocatedTotal = Number((await client.query(
          'SELECT coalesce(sum(amount),0) as sum FROM payment_allocations WHERE vendor_id=$1 AND id NOT IN (SELECT allocation_id FROM allocation_reversals)',
          [vendorId]
        )).rows[0].sum);

        const standaloneCreditsTotal = Number((await client.query(
          "SELECT coalesce(sum(amount),0) as sum FROM credit_notes WHERE vendor_id=$1 AND status='ISSUED' AND invoice_revision_id IS NULL",
          [vendorId]
        )).rows[0].sum);

        const collectible = Math.max(0, roundMoney(invoicedTotal - standaloneCreditsTotal));
        const outstanding = Math.max(0, roundMoney(collectible - allocatedTotal));

        const overdueTotal = Number((await client.query(
          "SELECT coalesce(sum(total),0) as sum FROM invoices WHERE vendor_id=$1 AND document_state='ISSUED' AND due_date < CURRENT_DATE",
          [vendorId]
        )).rows[0].sum);

        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const usage = (await client.query('SELECT * FROM monthly_usage WHERE vendor_id=$1 AND month_start=$2', [vendorId, monthStart])).rows[0];
        const quotaUsed = usage?.issued_count ?? 0;
        const quotaLimit = usage?.invoice_limit ?? 10;

        return {
          approvals_count: approvalsCount,
          invoiced_total: invoicedTotal,
          collected_total: collectedTotal,
          outstanding_total: outstanding,
          overdue_total: overdueTotal,
          monthly_quota: {
            used: quotaUsed,
            limit: quotaLimit,
            remaining: Math.max(0, quotaLimit - quotaUsed),
          },
        };
      });
    },

    async getReport(vendorId: string, type: 'INVOICES' | 'PAYMENTS' | 'CUSTOMERS' | 'AGEING', filters?: any) {
      return withTenant(db, vendorId, async client => {
        if (type === 'INVOICES') {
          const rows = (await client.query(
            `SELECT i.id,i.invoice_number,i.invoice_date,i.due_date,i.approval_state,i.document_state,
                    i.total, c.name as customer_name
             FROM invoices i
             JOIN customers c ON i.customer_id=c.id
             WHERE i.vendor_id=$1 ORDER BY i.created_at DESC`,
            [vendorId]
          )).rows;
          return { type: 'INVOICES', rows };
        } else if (type === 'PAYMENTS') {
          const rows = (await client.query(
            `SELECT p.id,p.amount,p.method,p.source,p.received_at,p.reference,c.name as customer_name
             FROM payments p
             JOIN customers c ON p.customer_id=c.id
             WHERE p.vendor_id=$1 ORDER BY p.received_at DESC`,
            [vendorId]
          )).rows;
          return { type: 'PAYMENTS', rows };
        } else if (type === 'CUSTOMERS') {
          const rows = (await client.query(
            `SELECT c.id,c.name,c.email,c.phone,c.status,
                    count(i.id) as total_invoices,
                    coalesce(sum(i.total),0) as total_invoiced
             FROM customers c
             LEFT JOIN invoices i ON c.id=i.customer_id AND i.document_state='ISSUED'
             WHERE c.vendor_id=$1
             GROUP BY c.id,c.name,c.email,c.phone,c.status ORDER BY c.name ASC`,
            [vendorId]
          )).rows;
          return { type: 'CUSTOMERS', rows };
        } else {
          // Ageing report (current, 1-30 days overdue, 31-60, 61-90, 90+)
          const rows = (await client.query(
            `SELECT i.id,i.invoice_number,i.invoice_date,i.due_date,i.total,
                    c.name as customer_name,
                    CURRENT_DATE - i.due_date as days_overdue
             FROM invoices i
             JOIN customers c ON i.customer_id=c.id
             WHERE i.vendor_id=$1 AND i.document_state='ISSUED'`,
            [vendorId]
          )).rows;
          return { type: 'AGEING', rows };
        }
      });
    },

    async listAuditEvents(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM audit_events WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 100', [vendorId])).rows;
      });
    },

    // Platform Admin
    async getAdminDashboard(platformOwnerId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      const vendorStats = (await client.query('SELECT status, count(*) FROM vendors GROUP BY status')).rows;
      const pendingChanges = Number((await client.query("SELECT count(*) FROM change_requests WHERE status='SUBMITTED'")).rows[0].count);
      const failedJobs = Number((await client.query("SELECT count(*) FROM outbox_jobs WHERE status='DEAD'")).rows[0].count);
      return {
        vendor_stats: vendorStats,
        pending_changes: pendingChanges,
        failed_jobs: failedJobs,
      };
      });
    },

    async listAdminJobs(platformOwnerId: string, status?: string, kind?: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      let sql = 'SELECT * FROM outbox_jobs WHERE 1=1';
      const params: any[] = [];
      if (status) {
        params.push(status);
        sql += ` AND status=$${params.length}`;
      }
      if (kind) {
        params.push(kind);
        sql += ` AND kind=$${params.length}`;
      }
      sql += ' ORDER BY created_at DESC LIMIT 100';
      return (await client.query(sql, params)).rows;
      });
    },

    async retryAdminJob(platformOwnerId: string, jobId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      await client.query("UPDATE outbox_jobs SET status='READY',attempts=0,lease_token=NULL,lease_until=NULL WHERE id=$1", [jobId]);
      return { retried: true };
      });
    },

    async listAdminProviderEvents(platformOwnerId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      return (await client.query('SELECT id,provider,event_type,status,received_at,processed_at,error_code FROM provider_events ORDER BY received_at DESC LIMIT 100')).rows;
      });
    },

    async reprocessAdminProviderEvent(platformOwnerId: string, id: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      const event=(await client.query("SELECT * FROM provider_events WHERE id=$1 AND provider='RAZORPAY'",[id])).rows[0];
      if(!event)throw new HttpError(404,'EVENT_NOT_FOUND','Provider event not found.');
      return applyPaymentEvent(db,config,unseal(event.payload_ciphertext,config.DELIVERY_KEY),event.external_event_id);
      });
    },

    async listEmailSuppressions(platformOwnerId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      return (await client.query('SELECT * FROM email_suppressions ORDER BY created_at DESC LIMIT 100')).rows;
      });
    },

    async clearEmailSuppression(platformOwnerId: string, id: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      await client.query('UPDATE email_suppressions SET cleared_at=now() WHERE id=$1', [id]);
      return { cleared: true };
      });
    },

    async listAdminAuditEvents(platformOwnerId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      return (await client.query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100')).rows;
      });
    },
  };
}
