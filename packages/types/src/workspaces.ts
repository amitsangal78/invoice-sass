import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const acceptInvitationSchema = z.object({
  password: z.string().min(8).optional(), // required only when the invitation creates a new user — see identity-and-rbac/design.md
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
