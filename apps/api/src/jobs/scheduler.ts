import { Queue, Worker } from 'bullmq';
import { getEnv } from '../lib/env';
import { markOverdueInvoices } from './mark-overdue-invoices';
import { sendReminders } from './send-reminders';
import { expireStaleInvitations } from './expire-stale-invitations';

const connection = { url: getEnv().REDIS_URL };

export const scheduledJobsQueue = new Queue('scheduled-jobs', { connection });

/** Call once at process startup (apps/api/src/index.ts) — not imported by
 * the test suite, which calls the job functions directly. */
export async function registerScheduledJobs(): Promise<void> {
  await scheduledJobsQueue.add('mark-overdue-invoices', {}, { repeat: { pattern: '0 1 * * *' }, jobId: 'mark-overdue-invoices' }); // daily 01:00
  await scheduledJobsQueue.add('send-reminders', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'send-reminders' }); // daily 02:00
  await scheduledJobsQueue.add('expire-stale-invitations', {}, { repeat: { pattern: '0 3 * * *' }, jobId: 'expire-stale-invitations' }); // daily 03:00

  new Worker(
    'scheduled-jobs',
    async (job) => {
      if (job.name === 'mark-overdue-invoices') return markOverdueInvoices();
      if (job.name === 'send-reminders') return sendReminders();
      if (job.name === 'expire-stale-invitations') return expireStaleInvitations();
    },
    { connection },
  );
}
