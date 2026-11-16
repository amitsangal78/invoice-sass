import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
import { type Database, withTenant, withPlatformOwner } from '@invoice/database';
import { seal, secretHmac } from '@invoice/database/crypto';
import type { Config } from '../config';
import { HttpError } from '../errors';

export function vendorService(db: Database, config: Config) {
  return {
    async getVendor(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        const row = (await client.query(`SELECT v.id,v.status,v.timezone,v.current_profile_id,v.version,v.created_at,v.updated_at,(SELECT jsonb_build_object('status',cr.status,'reason',cr.reason,'reviewed_at',cr.reviewed_at) FROM change_requests cr WHERE cr.vendor_id=v.id AND cr.kind='ONBOARDING' ORDER BY cr.created_at DESC,cr.id DESC LIMIT 1) AS onboarding_review FROM vendors v WHERE v.id=$1`, [vendorId])).rows[0];
        if (!row) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
        return row;
      });
    },

    async patchOnboarding(vendorId: string, draft: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT status,version,current_profile_id FROM vendors WHERE id=$1 FOR UPDATE', [vendorId])).rows[0];
        if (!vendor) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
        if (vendor.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Vendor state was modified.');
        if (!['DRAFT', 'MORE_INFO', 'REJECTED'].includes(vendor.status)) {
          throw new HttpError(400, 'INVALID_LIFECYCLE', 'Cannot edit onboarding profile in current status.');
        }

        let profileId = vendor.current_profile_id;
        if (!profileId) {
          profileId = randomUUID();
          await client.query(
            `INSERT INTO vendor_profiles(id,vendor_id,version_no,business_name,address,contact_email,contact_mobile,gstin,default_tax_profile_id)
             VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)`,
            [
              profileId,
              vendorId,
              draft.business_name ?? 'My Business',
              JSON.stringify(draft.address ?? {}),
              draft.contact_email ?? 'billing@business.com',
              draft.contact_mobile ?? null,
              draft.gstin ?? null,
              draft.default_tax_profile_id ?? null,
            ]
          );
          await client.query('UPDATE vendors SET current_profile_id=$1,version=version+1 WHERE id=$2', [profileId, vendorId]);
        } else {
          await client.query(
            `UPDATE vendor_profiles SET
               business_name=coalesce($2,business_name),
               address=case when $3::jsonb is not null then $3::jsonb else address end,
               contact_email=coalesce($4,contact_email),
               contact_mobile=coalesce($5,contact_mobile),
               gstin=coalesce($6,gstin),
               default_tax_profile_id=coalesce($7,default_tax_profile_id),
               version=version+1
             WHERE id=$1`,
            [
              profileId,
              draft.business_name,
              draft.address ? JSON.stringify(draft.address) : null,
              draft.contact_email,
              draft.contact_mobile,
              draft.gstin,
              draft.default_tax_profile_id,
            ]
          );
        }
        return (await client.query('SELECT id,status,timezone,current_profile_id,version FROM vendors WHERE id=$1', [vendorId])).rows[0];
      });
    },

    async submitOnboarding(vendorId: string, membershipId: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT status,version,current_profile_id FROM vendors WHERE id=$1 FOR UPDATE', [vendorId])).rows[0];
        if (!vendor) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
        if (vendor.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Vendor state was modified.');
        if (!['DRAFT', 'MORE_INFO', 'REJECTED'].includes(vendor.status)) {
          throw new HttpError(400, 'INVALID_LIFECYCLE', 'Cannot submit in current status.');
        }
        if (!vendor.current_profile_id) {
          throw new HttpError(400, 'PROFILE_REQUIRED', 'Please provide profile details before submitting.');
        }

        const crId = randomUUID();
        await client.query(
          `INSERT INTO change_requests(id,vendor_id,kind,target,base_profile_id,proposed_profile_id,status,requested_by_membership_id)
           VALUES($1,$2,'ONBOARDING','ONBOARDING',$3,$3,'SUBMITTED',$4)`,
          [crId, vendorId, vendor.current_profile_id, membershipId]
        );
        await client.query("UPDATE vendors SET status='SUBMITTED',version=version+1 WHERE id=$1", [vendorId]);
        return (await client.query('SELECT * FROM change_requests WHERE id=$1', [crId])).rows[0];
      });
    },

    async getProfile(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT current_profile_id FROM vendors WHERE id=$1', [vendorId])).rows[0];
        if (!vendor?.current_profile_id) return null;
        return (await client.query('SELECT * FROM vendor_profiles WHERE id=$1', [vendor.current_profile_id])).rows[0];
      });
    },

    async patchNonSensitiveProfile(vendorId: string, patch: { default_tax_profile_id?: string | null; version: number }) {
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT current_profile_id FROM vendors WHERE id=$1', [vendorId])).rows[0];
        if (!vendor?.current_profile_id) throw new HttpError(400, 'PROFILE_NOT_FOUND', 'Profile does not exist.');
        const profile = (await client.query('SELECT version FROM vendor_profiles WHERE id=$1 FOR UPDATE', [vendor.current_profile_id])).rows[0];
        if (profile.version !== patch.version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Profile version conflict.');
        await client.query(
          'UPDATE vendor_profiles SET default_tax_profile_id=$2,version=version+1 WHERE id=$1',
          [vendor.current_profile_id, patch.default_tax_profile_id ?? null]
        );
        return (await client.query('SELECT * FROM vendor_profiles WHERE id=$1', [vendor.current_profile_id])).rows[0];
      });
    },

    async createChangeRequest(vendorId: string, membershipId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const vendor = (await client.query('SELECT current_profile_id FROM vendors WHERE id=$1', [vendorId])).rows[0];
        const id = randomUUID();
        let target = 'BUSINESS_IDENTITY';
        if (input.proposed_changes.contact_email) target = 'CONTACT_EMAIL';
        if (input.proposed_changes.contact_mobile) target = 'CONTACT_MOBILE';
        if (input.proposed_changes.payment_details) target = 'PAYMENT_DETAILS';

        let proposedProfileId = vendor?.current_profile_id ?? null;
        if (input.proposed_changes) {
          proposedProfileId = randomUUID();
          const curr = vendor?.current_profile_id
            ? (await client.query('SELECT * FROM vendor_profiles WHERE id=$1', [vendor.current_profile_id])).rows[0]
            : null;
          const nextVersion = (curr?.version_no ?? 0) + 1;
          await client.query(
            `INSERT INTO vendor_profiles(id,vendor_id,version_no,business_name,address,contact_email,contact_mobile,gstin,default_tax_profile_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              proposedProfileId,
              vendorId,
              nextVersion,
              input.proposed_changes.business_name ?? curr?.business_name ?? 'Business',
              JSON.stringify(input.proposed_changes.address ?? curr?.address ?? {}),
              input.proposed_changes.contact_email ?? curr?.contact_email ?? 'billing@business.com',
              input.proposed_changes.contact_mobile ?? curr?.contact_mobile ?? null,
              input.proposed_changes.gstin ?? curr?.gstin ?? null,
              curr?.default_tax_profile_id ?? null,
            ]
          );
        }

        await client.query(
          `INSERT INTO change_requests(id,vendor_id,kind,target,base_profile_id,proposed_profile_id,status,requested_by_membership_id)
           VALUES($1,$2,$3,$4,$5,$6,'SUBMITTED',$7)`,
          [id, vendorId, input.kind, target, vendor?.current_profile_id ?? null, proposedProfileId, membershipId]
        );
        return (await client.query('SELECT * FROM change_requests WHERE id=$1', [id])).rows[0];
      });
    },

    async listChangeRequests(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM change_requests WHERE vendor_id=$1 ORDER BY created_at DESC', [vendorId])).rows;
      });
    },

    async requestChangeRequestEmailVerification(vendorId: string, changeRequestId: string) {
      return withTenant(db, vendorId, async client => {
        const cr = (await client.query('SELECT * FROM change_requests WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [changeRequestId, vendorId])).rows[0];
        if (!cr || cr.status !== 'SUBMITTED' || cr.target !== 'CONTACT_EMAIL') throw new HttpError(404, 'CHANGE_REQUEST_NOT_FOUND', 'Pending email change not found.');
        const proposed = (await client.query('SELECT contact_email FROM vendor_profiles WHERE id=$1', [cr.proposed_profile_id])).rows[0];
        if (!proposed?.contact_email) throw new HttpError(400, 'NO_EMAIL_CHANGE', 'No email change in this request.');
        const scope = `change-request:${cr.id}`;
        const active = (await client.query('SELECT created_at FROM otp_challenges WHERE scope_key=$1 AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1', [scope])).rows[0];
        if (active && Date.now()-new Date(active.created_at).getTime()<60_000) throw new HttpError(429,'OTP_RESEND_WAIT','Wait before requesting another code.');
        await client.query('UPDATE otp_challenges SET invalidated_at=now() WHERE scope_key=$1 AND consumed_at IS NULL AND invalidated_at IS NULL', [scope]);
        const id=randomUUID(), code=String(randomInt(0,1_000_000)).padStart(6,'0');
        await client.query(`INSERT INTO otp_challenges(id,change_request_id,purpose,code_hmac,scope_key,expires_at)
          VALUES($1,$2,'CONTACT_EMAIL_VERIFY',$3,$4,now()+interval '5 minutes')`, [id,cr.id,secretHmac(config.OTP_SECRET,`${id}:${code}`),scope]);
        await client.query(`INSERT INTO outbox_jobs(kind,vendor_id,business_key,payload,encrypted_payload)
          VALUES('OTP',$1,$2,$3,$4)`, [vendorId,`change-request-otp:${id}`,JSON.stringify({challenge_id:id}),seal({to:proposed.contact_email,code,purpose:'CONTACT_EMAIL_VERIFY',expires_at:new Date(Date.now()+300_000).toISOString()},config.DELIVERY_KEY)]);
        return {challenge_id:id,expires_in_seconds:300,resend_after_seconds:60};
      });
    },

    async verifyChangeRequestEmail(vendorId: string, changeRequestId: string, challengeId: string, code: string) {
      const result = await withTenant(db, vendorId, async client => {
        const cr = (await client.query('SELECT * FROM change_requests WHERE id=$1 AND vendor_id=$2 FOR UPDATE',[changeRequestId,vendorId])).rows[0];
        if (!cr || cr.status !== 'SUBMITTED' || cr.target !== 'CONTACT_EMAIL') throw new HttpError(404,'CHANGE_REQUEST_NOT_FOUND','Pending email change not found.');
        const challenge=(await client.query("SELECT * FROM otp_challenges WHERE id=$1 AND change_request_id=$2 AND purpose='CONTACT_EMAIL_VERIFY' FOR UPDATE",[challengeId,changeRequestId])).rows[0];
        if (!challenge || challenge.consumed_at || challenge.invalidated_at || new Date(challenge.expires_at)<=new Date() || challenge.attempts>=5) throw new HttpError(401,'OTP_INVALID','The code is invalid or expired.');
        if (!timingSafeEqual(challenge.code_hmac,secretHmac(config.OTP_SECRET,`${challengeId}:${code}`))) {
          await client.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1',[challengeId]);
          return new HttpError(401,'OTP_INVALID','The code is invalid or expired.');
        }
        await client.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1',[challengeId]);
        return (await client.query('UPDATE change_requests SET email_verified_at=now(),version=version+1 WHERE id=$1 RETURNING *',[changeRequestId])).rows[0];
      });
      if (result instanceof HttpError) throw result;
      return result;
    },

    async getMonthlyUsage(vendorId: string, monthStr?: string) {
      return withTenant(db, vendorId, async client => {
        const month = monthStr ? new Date(`${monthStr}-01`) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const row = (await client.query('SELECT * FROM monthly_usage WHERE vendor_id=$1 AND month_start=$2', [vendorId, month])).rows[0];
        return {
          month: month.toISOString().slice(0, 7),
          issued_count: row?.issued_count ?? 0,
          invoice_limit: row?.invoice_limit ?? 10,
          remaining: (row?.invoice_limit ?? 10) - (row?.issued_count ?? 0),
          timezone: 'Asia/Kolkata',
        };
      });
    },

    // Platform Owner admin methods
    async listAdminVendors(platformOwnerId: string, status?: string, q?: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      let query = `SELECT v.*, vp.business_name, vp.contact_email, owner_user.email AS owner_email,
        owner_user.email_verified_at AS owner_email_verified_at,
        pending.id AS onboarding_request_id,pending.version AS onboarding_request_version
        FROM vendors v LEFT JOIN vendor_profiles vp ON v.current_profile_id=vp.id
        LEFT JOIN memberships owner_membership ON owner_membership.vendor_id=v.id AND owner_membership.role='OWNER' AND owner_membership.status<>'REMOVED'
        LEFT JOIN users owner_user ON owner_user.id=owner_membership.user_id
        LEFT JOIN LATERAL (SELECT cr.id,cr.version FROM change_requests cr WHERE cr.vendor_id=v.id AND cr.kind='ONBOARDING' AND cr.status='SUBMITTED' ORDER BY cr.created_at DESC LIMIT 1) pending ON true
        WHERE 1=1`;
      const params: any[] = [];
      if (status) {
        params.push(status);
        query += ` AND v.status=$${params.length}`;
      }
      if (q) {
        params.push(`%${q}%`);
        query += ` AND (vp.business_name ILIKE $${params.length} OR vp.contact_email ILIKE $${params.length} OR owner_user.email ILIKE $${params.length})`;
      }
      query += ' ORDER BY v.created_at DESC';
      return (await client.query(query, params)).rows;
      });
    },

    async getAdminVendor(platformOwnerId: string, vendorId: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      const vendor = (await client.query('SELECT * FROM vendors WHERE id=$1', [vendorId])).rows[0];
      if (!vendor) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
      const profile = vendor.current_profile_id
        ? (await client.query('SELECT * FROM vendor_profiles WHERE id=$1', [vendor.current_profile_id])).rows[0]
        : null;
      const creators = (await client.query("SELECT count(*) FROM memberships WHERE vendor_id=$1 AND role='CREATOR' AND status<>'REMOVED'", [vendorId])).rows[0].count;
      const owner=(await client.query(`SELECT u.email,u.email_verified_at,u.status AS account_status,m.status AS membership_status
        FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.role='OWNER' AND m.status<>'REMOVED'`,[vendorId])).rows[0]??null;
      const requests=(await client.query(`SELECT cr.*,jsonb_build_object('business_name',p.business_name,'contact_email',p.contact_email,'contact_mobile',p.contact_mobile,'gstin',p.gstin,'address',p.address) AS proposed_profile
        FROM change_requests cr LEFT JOIN vendor_profiles p ON p.id=cr.proposed_profile_id WHERE cr.vendor_id=$1 ORDER BY cr.created_at DESC,cr.id DESC`,[vendorId])).rows;
      return { vendor, profile:profile?{business_name:profile.business_name,contact_email:profile.contact_email,contact_mobile:profile.contact_mobile,gstin:profile.gstin,address:profile.address}:null, owner, change_requests:requests, creator_count: Number(creators) };
      });
    },

    async listAdminChangeRequests(platformOwnerId: string, status?: string, kind?: string, vendorId?: string) {
      return withPlatformOwner(db, platformOwnerId, async client => {
      let query = `SELECT cr.*, v.status AS vendor_status,p.business_name,p.contact_email,u.email AS owner_email,u.email_verified_at AS owner_email_verified_at
        FROM change_requests cr JOIN vendors v ON cr.vendor_id=v.id
        LEFT JOIN vendor_profiles p ON p.id=coalesce(cr.proposed_profile_id,v.current_profile_id)
        LEFT JOIN memberships m ON m.vendor_id=v.id AND m.role='OWNER' AND m.status<>'REMOVED'
        LEFT JOIN users u ON u.id=m.user_id WHERE 1=1`;
      const params: any[] = [];
      if (status) {
        params.push(status);
        query += ` AND cr.status=$${params.length}`;
      }
      if (kind) {
        params.push(kind);
        query += ` AND cr.kind=$${params.length}`;
      }
      if (vendorId) {
        params.push(vendorId);
        query += ` AND cr.vendor_id=$${params.length}`;
      }
      query += ' ORDER BY cr.created_at DESC';
      return (await client.query(query, params)).rows;
      });
    },

    async reviewChangeRequest(id: string, platformOwnerId: string, decision: 'APPROVE' | 'REJECT' | 'MORE_INFO', reason?: string, version = 1) {
      return withPlatformOwner(db, platformOwnerId, async client => {
        const cr = (await client.query('SELECT * FROM change_requests WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!cr) throw new HttpError(404, 'CHANGE_REQUEST_NOT_FOUND', 'Change request not found.');
        if (cr.status !== 'SUBMITTED') throw new HttpError(400, 'INVALID_LIFECYCLE', 'Request was already decided.');
        if (cr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Conflict in request version.');
        const vendor=(await client.query('SELECT status FROM vendors WHERE id=$1 FOR UPDATE',[cr.vendor_id])).rows[0];
        if(vendor?.status==='BLOCKED')throw new HttpError(409,'VENDOR_BLOCKED','Restore the vendor before reviewing its request.');
        if(cr.kind==='ONBOARDING'&&vendor?.status!=='SUBMITTED')throw new HttpError(409,'INVALID_LIFECYCLE','This vendor is not awaiting onboarding review.');
        if(decision!=='APPROVE'&&!reason?.trim())throw new HttpError(422,'REASON_REQUIRED','Provide a reason for rejection or a request for more information.');
        reason=reason?.trim();


        if (decision === 'APPROVE' && cr.target === 'CONTACT_EMAIL' && !cr.email_verified_at) throw new HttpError(400, 'EMAIL_VERIFICATION_REQUIRED', 'Verify the proposed contact email first.');
        const nextStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'MORE_INFO';
        await client.query(
          'UPDATE change_requests SET status=$2,reviewed_by_id=$3,reason=$4,reviewed_at=now(),version=version+1 WHERE id=$1',
          [id, nextStatus, (await client.query('SELECT id FROM platform_owners WHERE user_id=$1',[platformOwnerId])).rows[0].id, reason ?? null]
        );

        if (decision === 'APPROVE') {
          if (cr.proposed_profile_id) {
            await client.query('UPDATE vendor_profiles SET approved_at=now() WHERE id=$1', [cr.proposed_profile_id]);
            await client.query('UPDATE vendors SET current_profile_id=$1,status=\'APPROVED\',version=version+1 WHERE id=$2', [cr.proposed_profile_id, cr.vendor_id]);
          } else {
            await client.query("UPDATE vendors SET status='APPROVED',version=version+1 WHERE id=$1", [cr.vendor_id]);
          }
        } else if (decision === 'REJECT') {
          if (cr.kind === 'ONBOARDING') {
            await client.query("UPDATE vendors SET status='REJECTED',version=version+1 WHERE id=$1", [cr.vendor_id]);
          }
        } else if (decision === 'MORE_INFO') {
          if (cr.kind === 'ONBOARDING') {
            await client.query("UPDATE vendors SET status='MORE_INFO',version=version+1 WHERE id=$1", [cr.vendor_id]);
          }
        }
        return (await client.query('SELECT * FROM change_requests WHERE id=$1', [id])).rows[0];
      });
    },

    async blockVendor(platformOwnerId: string, vendorId: string, reason: string, version: number) {
      return withPlatformOwner(db, platformOwnerId, async client => {
        const vendor = (await client.query('SELECT status,version FROM vendors WHERE id=$1 FOR UPDATE', [vendorId])).rows[0];
        if (!vendor) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
        if (vendor.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Vendor state was modified.');
        if (vendor.status === 'BLOCKED') throw new HttpError(400, 'ALREADY_BLOCKED', 'Vendor is already blocked.');

        await client.query(
          "UPDATE vendors SET status='BLOCKED',blocked_from_status=$2,blocked_at=now(),block_reason=$3,version=version+1 WHERE id=$1",
          [vendorId, vendor.status, reason]
        );
        // Revoke all active sessions for this vendor's members
        const members = (await client.query('SELECT user_id FROM memberships WHERE vendor_id=$1 AND user_id IS NOT NULL', [vendorId])).rows;
        for (const m of members) {
          await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [m.user_id]);
        }
        return (await client.query('SELECT id,status,blocked_at,blocked_from_status,block_reason,version FROM vendors WHERE id=$1', [vendorId])).rows[0];
      });
    },

    async restoreVendor(platformOwnerId: string, vendorId: string, reason?: string, version = 1) {
      return withPlatformOwner(db, platformOwnerId, async client => {
        const vendor = (await client.query('SELECT status,blocked_from_status,version FROM vendors WHERE id=$1 FOR UPDATE', [vendorId])).rows[0];
        if (!vendor) throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
        if (vendor.status !== 'BLOCKED') throw new HttpError(400, 'NOT_BLOCKED', 'Vendor is not blocked.');
        if (vendor.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Vendor state was modified.');

        const restoreStatus = vendor.blocked_from_status ?? 'DRAFT';
        await client.query(
          'UPDATE vendors SET status=$2,blocked_at=NULL,blocked_from_status=NULL,block_reason=NULL,version=version+1 WHERE id=$1',
          [vendorId, restoreStatus]
        );
        return (await client.query('SELECT id,status,version FROM vendors WHERE id=$1', [vendorId])).rows[0];
      });
    },
  };
}
