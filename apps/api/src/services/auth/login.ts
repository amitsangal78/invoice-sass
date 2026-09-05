import { eq } from 'drizzle-orm';
import { type Database, users, refreshTokens } from '@invoice-saas/db';
import type { LoginInput } from '@invoice-saas/types';
import { verifyPassword } from '../../lib/auth/password';
import { generateSecureToken } from '../../lib/auth/tokens';
import { signAccessToken } from '../../lib/auth/jwt';
import { writeAuditEvent } from '../../lib/audit';
import { AccountSuspendedError, InvalidCredentialsError } from '../../lib/errors';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — identity-and-rbac/design.md

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; platformRole: string };
}

export async function login(db: Database, input: LoginInput): Promise<LoginResult> {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });

  // Deliberately generic failure for "no such user" and "wrong password" alike
  // — never reveal which field was wrong (identity-and-rbac/design.md).
  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    await writeAuditEvent(db, { event: 'LOGIN_FAILED', userId: user.id });
    throw new InvalidCredentialsError();
  }

  if (!user.isActive) {
    throw new AccountSuspendedError();
  }

  const accessToken = signAccessToken({ sub: user.id, platformRole: user.platformRole });
  const refresh = generateSecureToken();

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  await writeAuditEvent(db, { event: 'LOGIN_SUCCESS', userId: user.id });

  return {
    accessToken,
    refreshToken: refresh.raw,
    user: { id: user.id, email: user.email, platformRole: user.platformRole },
  };
}
