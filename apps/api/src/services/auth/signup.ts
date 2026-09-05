import { eq } from 'drizzle-orm';
import {
  type Database,
  users,
  workspaces,
  workspaceMembers,
  emailVerificationTokens,
  subscriptions,
  reminderRules,
} from '@invoice-saas/db';
import type { SignupInput } from '@invoice-saas/types';
import { hashPassword } from '../../lib/auth/password';
import { generateSecureToken } from '../../lib/auth/tokens';
import { sendEmail } from '../../lib/email';
import { ApiHttpError } from '../../lib/errors';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_REMINDER_OFFSETS = [-3, 0, 3, 10]; // before-due, on-due, +3d overdue, +10d overdue

export interface SignupResult {
  userId: string;
  workspaceId: string;
}

/**
 * Bootstraps a brand-new tenant: user, workspace, ownership, ADMIN membership,
 * a FREE subscription, and default reminder rules — all in one transaction so
 * a crash partway through never leaves a workspace without an owner/plan.
 * See identity-and-rbac/design.md (auth flow) and the two forward-notes in
 * core-invoicing/tasks.md and subscription-billing/design.md that assign
 * these extra responsibilities to signup() rather than duplicating
 * workspace-creation logic elsewhere.
 */
export async function signup(db: Database, input: SignupInput): Promise<SignupResult> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) {
    throw new ApiHttpError(409, 'email_taken', 'An account with this email already exists.');
  }

  const passwordHash = await hashPassword(input.password);
  const verificationToken = generateSecureToken();

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, platformRole: 'NORMAL_USER' })
      .returning();
    if (!user) throw new Error('User insert returned no row');

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: input.workspaceName, ownerId: user.id })
      .returning();
    if (!workspace) throw new Error('Workspace insert returned no row');

    await tx.insert(workspaceMembers).values({ userId: user.id, workspaceId: workspace.id, role: 'ADMIN' });

    await tx.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'FREE', status: 'ACTIVE' });

    await tx
      .insert(reminderRules)
      .values(DEFAULT_REMINDER_OFFSETS.map((offsetDays) => ({ workspaceId: workspace.id, offsetDays })));

    await tx.insert(emailVerificationTokens).values({
      userId: user.id,
      tokenHash: verificationToken.hash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });

    return { userId: user.id, workspaceId: workspace.id };
  });

  await sendEmail(
    input.email,
    'Verify your Billify account',
    `Welcome to Billify. Verify your email: /auth/verify-email?token=${verificationToken.raw}`,
  );

  return result;
}
