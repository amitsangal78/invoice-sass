// Placeholder transactional-email sender. Real SES wiring + the actual
// templates (packages/email-templates) are a separate follow-up — see
// identity-and-rbac/tasks.md task 9. Every call site below depends only on
// this function's signature, so swapping the implementation later touches
// one file, not every service that sends mail.
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') return; // don't spam logs during test runs
  // eslint-disable-next-line no-console
  console.log(`[email:stub] to=${to} subject="${subject}"\n${body}`);
}
