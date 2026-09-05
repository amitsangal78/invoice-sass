import * as argon2 from 'argon2';

// Argon2id — per tech.md/identity-and-rbac/design.md, never bcrypt-or-weaker by
// default, never plain storage.
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // argon2.verify throws on a malformed hash rather than returning false —
    // treat that the same as "doesn't match" so a corrupt hash can't crash a
    // login attempt into a 500.
    return false;
  }
}
