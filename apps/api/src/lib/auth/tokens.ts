import { randomBytes, createHash } from 'node:crypto';

export interface GeneratedToken {
  /** Sent to the user (email link, response body) — never persisted. */
  raw: string;
  /** SHA-256 hex digest — what actually gets stored. */
  hash: string;
}

// Shared by refresh tokens, email-verification tokens, password-reset tokens,
// and invitation/magic-link tokens — one implementation to audit, not four
// (identity-and-rbac/design.md task 2).
export function generateSecureToken(): GeneratedToken {
  const raw = randomBytes(32).toString('hex'); // 256 bits
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
