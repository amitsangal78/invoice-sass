import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { policy, type Actor } from '@invoice/contracts';
import { transaction, withTenant, type Database, type PoolClient } from '@invoice/database';
import { checkPassword, hashPassword, seal, secretHmac, tokenHash } from '@invoice/database/crypto';
import type { Config } from './config';
import { HttpError } from './errors';

type User = { id: string; email: string; password_hash: string | null; status: string; auth_version: number; email_verified_at: Date | null };
type Context = { actor: Actor; authVersion: number };

async function context(client: PoolClient, user: User): Promise<Context> {
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'ACCOUNT_FROZEN', 'Account access is unavailable.');
  await client.query("SELECT set_config('app.identity_user_id',$1,true)", [user.id]);
  const membership = (await client.query('SELECT id,vendor_id,role,status FROM memberships WHERE user_id=$1 AND status<>\'REMOVED\'', [user.id])).rows[0];
  let role: Actor['role'], vendorStatus: string | null = null;
  if (membership) {
    if (membership.status !== 'ACTIVE') throw new HttpError(403, 'ACCOUNT_FROZEN', 'Account access is unavailable.');
    await client.query("SELECT set_config('app.vendor_id',$1,true)", [membership.vendor_id]);
    vendorStatus = (await client.query('SELECT status FROM vendors WHERE id=$1', [membership.vendor_id])).rows[0]?.status;
    if (!vendorStatus || vendorStatus === 'BLOCKED') throw new HttpError(403, 'VENDOR_BLOCKED', 'Vendor access is unavailable.');
    role = membership.role;
  } else {
    const admin = (await client.query("SELECT id FROM platform_owners WHERE user_id=$1 AND status='ACTIVE'", [user.id])).rows[0];
    if (!admin) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    role = 'PLATFORM_OWNER';
  }
  const required_actions: string[] = [];
  if (!user.email_verified_at) required_actions.push('VERIFY_EMAIL');
  if (role === 'OWNER' && vendorStatus !== 'APPROVED') required_actions.push('COMPLETE_ONBOARDING');
  return {
    authVersion: user.auth_version,
    actor: {
      user_id: user.id,
      email: user.email,
      role,
      membership_id: membership?.id ?? null,
      vendor_id: membership?.vendor_id ?? null,
      vendor_status: vendorStatus,
      restricted: !user.email_verified_at,
      required_actions,
    },
  };
}

export function identityService(db: Database, config: Config) {
  const dummy = hashPassword('dummy-password-for-equal-work');

  async function createOtp(client: PoolClient, user: User, purpose: 'EMAIL_VERIFY' | 'OWNER_LOGIN' | 'OWNER_RESET' | 'PLATFORM_RESET') {
    const active = (await client.query(
      'SELECT id,expires_at,created_at FROM otp_challenges WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND invalidated_at IS NULL FOR UPDATE',
      [user.id, purpose]
    )).rows[0];
    if (active && active.created_at.getTime() + 60_000 > Date.now() && active.expires_at > Date.now()) {
      return active.id as string;
    }
    await client.query(
      'UPDATE otp_challenges SET invalidated_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND invalidated_at IS NULL',
      [user.id, purpose]
    );
    const id = randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ciphertext = seal({ email: user.email }, config.DELIVERY_KEY);
    await client.query(
      `INSERT INTO otp_challenges(id,user_id,purpose,code_hmac,destination_ciphertext,scope_key,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')`,
      [id, user.id, purpose, secretHmac(config.OTP_SECRET, `${id}:${code}`), ciphertext, `${purpose}:${user.id}`]
    );
    await client.query(
      "INSERT INTO outbox_jobs(kind,business_key,payload,encrypted_payload) VALUES('OTP',$1,$2,$3)",
      [
        `${purpose.toLowerCase()}:${id}`,
        JSON.stringify({ challenge_id: id, purpose }),
        seal({ to: user.email, code, purpose, expires_at: new Date(Date.now() + policy.otpMs).toISOString() }, config.DELIVERY_KEY),
      ]
    );
    return id;
  }

  return {
    async throttle(scope: string, action: string, limit: number) {
      const result = await db.query(
        `INSERT INTO rate_limits(scope_hash,action,window_start,counter,expires_at)
         VALUES($1,$2,date_trunc('hour',now()),1,date_trunc('hour',now())+interval '1 hour')
         ON CONFLICT(scope_hash,action,window_start) DO UPDATE SET counter=rate_limits.counter+1 RETURNING counter`,
        [secretHmac(config.OTP_SECRET, scope), action]
      );
      if (result.rows[0].counter > limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    },

    async signup(input: { email: string; password: string }, key: string, requestId: string) {
      const hashed = await hashPassword(input.password);
      return transaction(db, async client => {
        const scope = secretHmac(config.OTP_SECRET, `signup:${input.email}`).toString('hex');
        const requestHash = secretHmac(config.OTP_SECRET, JSON.stringify(input));
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`signup:${scope}`]);
        const prior = (await client.query(
          "SELECT request_hash,result FROM idempotency_requests WHERE actor_scope=$1 AND operation='SIGNUP' AND request_key=$2",
          [scope, key]
        )).rows[0];
        if (prior) {
          if (!timingSafeEqual(prior.request_hash, requestHash)) {
            throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new key for a different request.');
          }
          return prior.result as { user_id: string; vendor_id: string; vendor_status: string; required_actions: string[] };
        }
        if ((await client.query('SELECT id FROM users WHERE email=$1', [input.email])).rowCount) {
          throw new HttpError(409, 'ACCOUNT_UNAVAILABLE', 'Unable to create this account. Try login or account recovery.');
        }
        const userId = randomUUID(), vendorId = randomUUID(), membershipId = randomUUID();
        await client.query("SELECT set_config('app.vendor_id',$1,true)", [vendorId]);
        const user = (await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING *', [userId, input.email, hashed])).rows[0] as User;
        await client.query('INSERT INTO vendors(id) VALUES($1)', [vendorId]);
        await client.query("INSERT INTO memberships(id,vendor_id,user_id,role,historical_label) VALUES($1,$2,$3,'OWNER','Vendor Owner')", [membershipId, vendorId, userId]);
        await createOtp(client, user, 'EMAIL_VERIFY');
        await client.query("INSERT INTO audit_events(vendor_id,actor_membership_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'OWNER_SIGNUP','vendors',$1,$3)", [vendorId, membershipId, requestId]);
        const result = { user_id: userId, vendor_id: vendorId, vendor_status: 'DRAFT', required_actions: ['VERIFY_EMAIL', 'COMPLETE_ONBOARDING'] };
        await client.query("INSERT INTO idempotency_requests(actor_scope,operation,request_key,request_hash,result) VALUES($1,'SIGNUP',$2,$3,$4)", [scope, key, requestHash, JSON.stringify(result)]);
        return result;
      });
    },

    async login(input: { email: string; password: string; client_type: 'WEB' | 'MOBILE' }) {
      const user = (await db.query('SELECT * FROM users WHERE email=$1', [input.email])).rows[0] as User | undefined;
      if (!await checkPassword(input.password, user?.password_hash ?? await dummy) || !user) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      return transaction(db, async client => {
        const current = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0] as User;
        if (current.auth_version !== user.auth_version || current.password_hash !== user.password_hash) {
          throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
        }
        const ctx = await context(client, current);
        if (ctx.actor.role === 'PLATFORM_OWNER' && input.client_type === 'MOBILE') {
          throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform administration is web-only.');
        }
        const token = randomBytes(32).toString('base64url');
        const result = await client.query(
          `INSERT INTO auth_sessions(user_id,membership_id,token_hash,auth_version,restricted,client_type,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') RETURNING expires_at`,
          [user.id, ctx.actor.membership_id, tokenHash(token), ctx.authVersion, ctx.actor.restricted, input.client_type]
        );
        return { actor: ctx.actor, expires_at: result.rows[0].expires_at.toISOString() as string, token };
      });
    },

    async authenticate(token: string) {
      return transaction(db, async client => {
        const session = (await client.query(
          `SELECT * FROM auth_sessions WHERE token_hash=$1 AND revoked_at IS NULL
           AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' FOR UPDATE`,
          [tokenHash(token)]
        )).rows[0];
        if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Please log in again.');
        const user = (await client.query('SELECT * FROM users WHERE id=$1', [session.user_id])).rows[0] as User | undefined;
        if (!user || session.auth_version !== user.auth_version) throw new HttpError(401, 'SESSION_EXPIRED', 'Please log in again.');
        const ctx = await context(client, user);
        if (ctx.actor.membership_id !== session.membership_id) throw new HttpError(401, 'SESSION_EXPIRED', 'Please log in again.');
        if (ctx.actor.role === 'PLATFORM_OWNER' && session.client_type === 'MOBILE') throw new HttpError(403, 'ROLE_FORBIDDEN', 'Platform administration is web-only.');
        await client.query('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [session.id]);
        return ctx.actor;
      });
    },

    async requestChallenge(address: string, purpose: 'EMAIL_VERIFY' | 'OWNER_LOGIN' | 'OWNER_RESET' | 'PLATFORM_RESET' | 'CUSTOMER_INVOICE' = 'EMAIL_VERIFY') {
      return transaction(db, async client => {
        const user = (await client.query('SELECT * FROM users WHERE email=$1 FOR UPDATE', [address])).rows[0] as User | undefined;
        if (!user || user.status !== 'ACTIVE') return randomUUID();
        if (purpose === 'OWNER_LOGIN' || purpose === 'OWNER_RESET') {
          const m = (await client.query("SELECT 1 FROM memberships WHERE user_id=$1 AND role='OWNER' AND status='ACTIVE'", [user.id])).rowCount;
          if (!m) return randomUUID();
        }
        if (purpose === 'PLATFORM_RESET') {
          const p = (await client.query("SELECT 1 FROM platform_owners WHERE user_id=$1 AND status='ACTIVE'", [user.id])).rowCount;
          if (!p) return randomUUID();
        }
        if (purpose === 'CUSTOMER_INVOICE') return randomUUID();
        return createOtp(client, user, purpose);
      });
    },

    async verify(id: string, code: string, purpose = 'EMAIL_VERIFY') {
      const result = await transaction(db, async client => {
        const row = (await client.query('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!row || row.purpose !== purpose || row.consumed_at || row.invalidated_at || row.expires_at <= new Date() || row.attempts >= 5) {
          return null;
        }
        if (!timingSafeEqual(row.code_hmac, secretHmac(config.OTP_SECRET, `${id}:${code}`))) {
          await client.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [id]);
          return null;
        }
        await client.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [id]);
        if (purpose === 'EMAIL_VERIFY') {
          await client.query('UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1', [row.user_id]);
          await client.query('UPDATE auth_sessions SET restricted=false WHERE user_id=$1', [row.user_id]);
        }
        await client.query(
          "UPDATE outbox_jobs SET status='CANCELLED',encrypted_payload=NULL,lease_token=NULL,lease_until=NULL WHERE business_key=$1 AND status IN ('READY','RETRY')",
          [`${purpose.toLowerCase()}:${id}`]
        );
        return row.user_id as string;
      });
      if (!result) throw new HttpError(401, 'OTP_INVALID', 'The verification code is invalid or expired.');
      return result;
    },

    async ownerOtpLogin(challengeId: string, code: string, clientType: 'WEB' | 'MOBILE') {
      const userId = await this.verify(challengeId, code, 'OWNER_LOGIN');
      return transaction(db, async client => {
        const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0] as User;
        const ctx = await context(client, user);
        if (ctx.actor.role !== 'OWNER') throw new HttpError(403, 'ROLE_FORBIDDEN', 'Owner access required.');
        const token = randomBytes(32).toString('base64url');
        const result = await client.query(
          `INSERT INTO auth_sessions(user_id,membership_id,token_hash,auth_version,restricted,client_type,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') RETURNING expires_at`,
          [user.id, ctx.actor.membership_id, tokenHash(token), ctx.authVersion, ctx.actor.restricted, clientType]
        );
        return { actor: ctx.actor, expires_at: result.rows[0].expires_at.toISOString() as string, token };
      });
    },

    async passwordRecoveryVerify(challengeId: string, code: string) {
      const row = (await db.query('SELECT purpose,user_id FROM otp_challenges WHERE id=$1', [challengeId])).rows[0];
      const purpose = (row?.purpose === 'PLATFORM_RESET') ? 'PLATFORM_RESET' : 'OWNER_RESET';
      const userId = await this.verify(challengeId, code, purpose);
      const grantToken = randomBytes(32).toString('base64url');
      await db.query(
        "INSERT INTO auth_grants(user_id,purpose,token_hash,expires_at) VALUES($1,'PASSWORD_RESET',$2,now()+interval '15 minutes')",
        [userId, tokenHash(grantToken)]
      );
      return { reset_grant: grantToken };
    },

    async passwordRecoveryComplete(grantToken: string, newPassword: string) {
      const hashed = await hashPassword(newPassword);
      await transaction(db, async client => {
        const grant = (await client.query(
          "SELECT id,user_id FROM auth_grants WHERE token_hash=$1 AND purpose='PASSWORD_RESET' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
          [tokenHash(grantToken)]
        )).rows[0];
        if (!grant) throw new HttpError(400, 'INVALID_GRANT', 'Password reset grant is invalid or expired.');
        await client.query('UPDATE auth_grants SET consumed_at=now() WHERE id=$1', [grant.id]);
        await client.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [hashed, grant.user_id]);
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [grant.user_id]);
      });
    },

    async passwordChange(userId: string, currentPassword: string, newPassword: string) {
      const user = (await db.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0] as User | undefined;
      if (!user || !user.password_hash || !await checkPassword(currentPassword, user.password_hash)) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
      }
      const hashed = await hashPassword(newPassword);
      await transaction(db, async client => {
        await client.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [hashed, userId]);
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      });
    },

    async listSessions(userId: string) {
      return (await db.query(
        `SELECT id,client_type,restricted,created_at,last_seen_at,expires_at
         FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
         ORDER BY last_seen_at DESC`,
        [userId]
      )).rows;
    },

    async revokeSession(userId: string, sessionId: string) {
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2', [sessionId, userId]);
    },

    async logout(token: string) {
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash(token)]);
    },

    // Creator management (Owner only, 5 active / 15 existing atomically checked under vendor lock)
    async listCreators(vendorId: string) {
      return withTenant(db, vendorId, async client => (await client.query(
        `SELECT m.id,m.role,m.status,m.historical_label,m.created_at,m.version,u.email
         FROM memberships m
         JOIN users u ON m.user_id=u.id
         WHERE m.vendor_id=$1 AND m.role='CREATOR' AND m.status<>'REMOVED'
         ORDER BY m.created_at ASC`,
        [vendorId]
      )).rows);
    },

    async createCreator(vendorId: string, input: { email: string; password: string; status: 'ACTIVE' | 'FROZEN' }) {
      const hashed = await hashPassword(input.password);
      return withTenant(db, vendorId, async client => {
        // Enforce vendor row lock
        await client.query('SELECT id FROM vendors WHERE id=$1 FOR UPDATE', [vendorId]);
        const existingCount = Number((await client.query(
          "SELECT count(*) FROM memberships WHERE vendor_id=$1 AND role='CREATOR' AND status<>'REMOVED'",
          [vendorId]
        )).rows[0].count);
        if (existingCount >= policy.existingCreators) {
          throw new HttpError(400, 'CREATOR_LIMIT_EXCEEDED', 'Maximum of 15 creator accounts per vendor reached.');
        }
        if (input.status === 'ACTIVE') {
          const activeCount = Number((await client.query(
            "SELECT count(*) FROM memberships WHERE vendor_id=$1 AND role='CREATOR' AND status='ACTIVE'",
            [vendorId]
          )).rows[0].count);
          if (activeCount >= policy.activeCreators) {
            throw new HttpError(400, 'CREATOR_ACTIVE_LIMIT_EXCEEDED', 'Maximum of 5 active creators reached.');
          }
        }
        if ((await client.query('SELECT id FROM users WHERE email=$1', [input.email])).rowCount) {
          throw new HttpError(409, 'ACCOUNT_UNAVAILABLE', 'This email is already registered.');
        }

        const userId = randomUUID(), membershipId = randomUUID();
        const user = (await client.query(
          'INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING *',
          [userId, input.email, hashed]
        )).rows[0] as User;

        const membership = (await client.query(
          `INSERT INTO memberships(id,vendor_id,user_id,role,status,historical_label)
           VALUES($1,$2,$3,'CREATOR',$4,$5) RETURNING id,role,status,historical_label,created_at,version`,
          [membershipId, vendorId, userId, input.status, input.email]
        )).rows[0];

        // Creator email verification challenge
        await createOtp(client, user, 'EMAIL_VERIFY');

        return { ...membership, email: input.email };
      });
    },

    async resetCreatorPassword(vendorId: string, creatorMembershipId: string, newPassword: string) {
      const hashed = await hashPassword(newPassword);
      await withTenant(db, vendorId, async client => {
        const m = (await client.query(
          "SELECT user_id FROM memberships WHERE id=$1 AND vendor_id=$2 AND role='CREATOR' AND status<>'REMOVED'",
          [creatorMembershipId, vendorId]
        )).rows[0];
        if (!m || !m.user_id) throw new HttpError(404, 'CREATOR_NOT_FOUND', 'Creator not found.');
        await client.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [hashed, m.user_id]);
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [m.user_id]);
      });
    },

    async freezeCreator(vendorId: string, creatorMembershipId: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const m = (await client.query(
          "SELECT user_id,version FROM memberships WHERE id=$1 AND vendor_id=$2 AND role='CREATOR' FOR UPDATE",
          [creatorMembershipId, vendorId]
        )).rows[0];
        if (!m) throw new HttpError(404, 'CREATOR_NOT_FOUND', 'Creator not found.');
        if (m.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Record was modified by another operation.');
        await client.query("UPDATE memberships SET status='FROZEN',version=version+1 WHERE id=$1", [creatorMembershipId]);
        if (m.user_id) {
          await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [m.user_id]);
        }
        return (await client.query('SELECT id,role,status,historical_label,version FROM memberships WHERE id=$1', [creatorMembershipId])).rows[0];
      });
    },

    async unfreezeCreator(vendorId: string, creatorMembershipId: string, version: number) {
      return withTenant(db, vendorId, async client => {
        await client.query('SELECT id FROM vendors WHERE id=$1 FOR UPDATE', [vendorId]);
        const m = (await client.query(
          "SELECT user_id,version,status FROM memberships WHERE id=$1 AND vendor_id=$2 AND role='CREATOR' FOR UPDATE",
          [creatorMembershipId, vendorId]
        )).rows[0];
        if (!m) throw new HttpError(404, 'CREATOR_NOT_FOUND', 'Creator not found.');
        if (m.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Record was modified by another operation.');
        const activeCount = Number((await client.query(
          "SELECT count(*) FROM memberships WHERE vendor_id=$1 AND role='CREATOR' AND status='ACTIVE'",
          [vendorId]
        )).rows[0].count);
        if (activeCount >= policy.activeCreators) {
          throw new HttpError(400, 'CREATOR_ACTIVE_LIMIT_EXCEEDED', 'Maximum of 5 active creators reached.');
        }
        await client.query("UPDATE memberships SET status='ACTIVE',version=version+1 WHERE id=$1", [creatorMembershipId]);
        return (await client.query('SELECT id,role,status,historical_label,version FROM memberships WHERE id=$1', [creatorMembershipId])).rows[0];
      });
    },

    async deleteCreator(vendorId: string, creatorMembershipId: string) {
      await withTenant(db, vendorId, async client => {
        const m = (await client.query(
          "SELECT user_id FROM memberships WHERE id=$1 AND vendor_id=$2 AND role='CREATOR' FOR UPDATE",
          [creatorMembershipId, vendorId]
        )).rows[0];
        if (!m) throw new HttpError(404, 'CREATOR_NOT_FOUND', 'Creator not found.');
        const isReferenced = Number((await client.query('SELECT 1 FROM invoices WHERE created_by_membership_id=$1 LIMIT 1', [creatorMembershipId])).rowCount ?? 0) > 0;
        if (isReferenced) {
          await client.query("UPDATE memberships SET status='REMOVED',removed_at=now(),user_id=NULL WHERE id=$1", [creatorMembershipId]);
          if (m.user_id) {
            await client.query("UPDATE users SET status='REMOVED' WHERE id=$1", [m.user_id]);
            await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [m.user_id]);
          }
        } else {
          await client.query('DELETE FROM memberships WHERE id=$1', [creatorMembershipId]);
          if (m.user_id) {
            await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [m.user_id]);
            await client.query('DELETE FROM otp_challenges WHERE user_id=$1', [m.user_id]);
            await client.query('DELETE FROM users WHERE id=$1', [m.user_id]);
          }
        }
      });
    },
  };
}
