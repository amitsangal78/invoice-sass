import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, magicLinkTokens } from '@invoice-saas/db';
import { requestMagicLink, verifyMagicLink, resolvePortalSession, listPortalBusinesses, logoutPortalSession } from './portal-auth';
import { createTestWorkspace } from '../../test/fixtures';
import { createClient } from '../clients/clients';
import { generateSecureToken } from '../../lib/auth/tokens';
import { InvalidTokenError } from '../../lib/errors';

describe('magic link lifecycle', () => {
  it('should authenticate with a valid, unexpired magic link and issue a session', async () => {
    const ws = await createTestWorkspace('portalclient1@example.com');
    await createClient(ws.workspaceId, { name: 'Payer Co', email: 'payer1@example.com' });

    await requestMagicLink('payer1@example.com');

    // Test-only shortcut: requestMagicLink() only persists the hash — insert
    // a fresh token this test controls to exercise verifyMagicLink().
    const token = generateSecureToken();
    const [existing] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, 'payer1@example.com'));
    await db.update(magicLinkTokens).set({ tokenHash: token.hash }).where(eq(magicLinkTokens.id, existing!.id));

    const result = await verifyMagicLink(token.raw);
    expect(result.email).toBe('payer1@example.com');

    const session = await resolvePortalSession(result.sessionToken);
    expect(session?.email).toBe('payer1@example.com');
  });

  it('should reject an unknown token', async () => {
    await expect(verifyMagicLink('not-a-real-token')).rejects.toThrow(InvalidTokenError);
  });

  it('should reject an expired token', async () => {
    const token = generateSecureToken();
    await db.insert(magicLinkTokens).values({ email: 'expired@example.com', tokenHash: token.hash, expiresAt: new Date(Date.now() - 1000) });
    await expect(verifyMagicLink(token.raw)).rejects.toThrow(InvalidTokenError);
  });

  it('should reject an already-used token', async () => {
    const token = generateSecureToken();
    await db.insert(magicLinkTokens).values({ email: 'usedtoken@example.com', tokenHash: token.hash, expiresAt: new Date(Date.now() + 60_000) });
    await verifyMagicLink(token.raw);
    await expect(verifyMagicLink(token.raw)).rejects.toThrow(InvalidTokenError);
  });

  it('should not reveal whether an email is a client of any workspace', async () => {
    await expect(requestMagicLink('never-a-client@example.com')).resolves.toBeUndefined();
  });

  it('should invalidate a session on logout', async () => {
    const token = generateSecureToken();
    await db.insert(magicLinkTokens).values({ email: 'logouttest@example.com', tokenHash: token.hash, expiresAt: new Date(Date.now() + 60_000) });
    const { sessionToken } = await verifyMagicLink(token.raw);

    expect(await resolvePortalSession(sessionToken)).not.toBeNull();
    await logoutPortalSession(sessionToken);
    expect(await resolvePortalSession(sessionToken)).toBeNull();
  });
});

describe('multi-workspace client isolation', () => {
  it('should list every workspace an email is a client of, kept separate', async () => {
    const wsA = await createTestWorkspace('bizA@example.com', 'Business A');
    const wsB = await createTestWorkspace('bizB@example.com', 'Business B');

    const clientA = await createClient(wsA.workspaceId, { name: 'Shared Payer', email: 'shared-payer@example.com' });
    const clientB = await createClient(wsB.workspaceId, { name: 'Shared Payer', email: 'shared-payer@example.com' });

    const businesses = await listPortalBusinesses('shared-payer@example.com');

    expect(businesses).toHaveLength(2);
    const clientIds = businesses.map((b) => b.clientId).sort();
    expect(clientIds).toEqual([clientA!.id, clientB!.id].sort());
  });
});
