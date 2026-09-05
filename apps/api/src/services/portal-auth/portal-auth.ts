import { and, eq, isNull, gt } from 'drizzle-orm';
import { db, clientUsers, magicLinkTokens, portalSessions, clients, workspaces } from '@invoice-saas/db';
import { generateSecureToken, hashToken } from '../../lib/auth/tokens';
import { sendEmail } from '../../lib/email';
import { InvalidTokenError } from '../../lib/errors';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 min — client-portal/design.md
const PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, no rotation — see design.md for why

/** Always resolves — no account enumeration, matching identity-and-rbac's
 * forgotPassword() pattern. Silently no-ops the email send if this address
 * isn't a client of any workspace. */
export async function requestMagicLink(email: string): Promise<void> {
  const matches = await db.select({ id: clientUsers.id }).from(clientUsers).where(eq(clientUsers.email, email));
  if (matches.length === 0) return;

  const token = generateSecureToken();
  await db.insert(magicLinkTokens).values({ email, tokenHash: token.hash, expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) });
  await sendEmail(email, 'Your Billify portal link', `View your invoices: /portal/verify?token=${token.raw}`);
}

export interface VerifyMagicLinkResult {
  sessionToken: string;
  email: string;
}

/** Verifying is email-scoped, not workspace-scoped — one magic link
 * authenticates every business this email is a client of (design.md's
 * multi-workspace resolution). */
export async function verifyMagicLink(rawToken: string): Promise<VerifyMagicLinkResult> {
  const hash = hashToken(rawToken);
  const record = await db.query.magicLinkTokens.findFirst({ where: eq(magicLinkTokens.tokenHash, hash) });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('portal magic');
  }

  const session = generateSecureToken();

  await db.transaction(async (tx) => {
    await tx.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));
    await tx.insert(portalSessions).values({
      email: record.email,
      tokenHash: session.hash,
      expiresAt: new Date(Date.now() + PORTAL_SESSION_TTL_MS),
    });
  });

  return { sessionToken: session.raw, email: record.email };
}

export async function logoutPortalSession(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await db.update(portalSessions).set({ revokedAt: new Date() }).where(eq(portalSessions.tokenHash, hash));
}

export interface PortalSessionInfo {
  email: string;
}

/** Used by the authenticatePortalSession middleware — kept here so the
 * lookup logic isn't duplicated between the middleware and any future
 * direct callers. */
export async function resolvePortalSession(rawToken: string): Promise<PortalSessionInfo | null> {
  const hash = hashToken(rawToken);
  const [session] = await db
    .select({ email: portalSessions.email })
    .from(portalSessions)
    .where(and(eq(portalSessions.tokenHash, hash), isNull(portalSessions.revokedAt), gt(portalSessions.expiresAt, new Date())));
  return session ?? null;
}

/** Powers `GET /portal/businesses` — every business this email is a client of. */
export async function listPortalBusinesses(email: string) {
  return db
    .select({ clientId: clientUsers.clientId, workspaceName: workspaces.name })
    .from(clientUsers)
    .innerJoin(clients, eq(clients.id, clientUsers.clientId))
    .innerJoin(workspaces, eq(workspaces.id, clients.workspaceId))
    .where(eq(clientUsers.email, email));
}
