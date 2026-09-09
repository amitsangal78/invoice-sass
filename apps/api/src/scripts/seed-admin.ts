/**
 * One-off CLI script to bootstrap the first platform-staff account.
 * There is deliberately no API endpoint for this — self-service creation of
 * a SUPER_ADMIN/SUPPORT_ADMIN account would defeat the point of the role.
 *
 * Usage: DATABASE_URL=... npx tsx src/scripts/seed-admin.ts <email> <password> [SUPER_ADMIN|SUPPORT_ADMIN]
 */
import { eq } from 'drizzle-orm';
import { db, users, closeDb } from '@invoice-saas/db';
import { hashPassword } from '../lib/auth/password';

async function main() {
  const [email, password, role = 'SUPER_ADMIN'] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: seed-admin.ts <email> <password> [SUPER_ADMIN|SUPPORT_ADMIN]');
    process.exit(1);
  }
  if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT_ADMIN') {
    console.error('Role must be SUPER_ADMIN or SUPPORT_ADMIN.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db.update(users).set({ platformRole: role, passwordHash }).where(eq(users.id, existing.id));
    // eslint-disable-next-line no-console -- CLI script output, not a debug leftover
    console.log(`Updated existing user ${email} to platformRole=${role}.`);
  } else {
    await db.insert(users).values({ email, passwordHash, platformRole: role, isVerified: true, isActive: true });
    // eslint-disable-next-line no-console -- CLI script output, not a debug leftover
    console.log(`Created new ${role} account: ${email}.`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error('seed-admin failed:', err);
  process.exit(1);
});
