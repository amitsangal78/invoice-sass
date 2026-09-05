import { z } from 'zod';

export const requestMagicLinkSchema = z.object({
  email: z.string().email(),
});
export type RequestMagicLinkInput = z.infer<typeof requestMagicLinkSchema>;

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
});
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;

export const updatePortalProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  billingAddress: z.string().max(500).optional(),
});
export type UpdatePortalProfileInput = z.infer<typeof updatePortalProfileSchema>;
