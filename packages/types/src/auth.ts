import { z } from 'zod';

// Shared by apps/api (request validation) and, later, apps/web/apps/mobile
// (form validation) — one schema, never redefined per app (rules/frontend-web.md).

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  workspaceName: z.string().min(1).max(200),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// { data: T } on success, { error: { code, message } } on failure — every
// route in this codebase uses this shape, no exceptions (rules/backend-api.md).
export interface ApiSuccess<T> {
  data: T;
}
export interface ApiError {
  error: { code: string; message: string };
}
