import { z } from 'zod';
export const configSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  OTP_SECRET: z.string().min(32).refine(s => !s.startsWith('replace-'), 'Generate a random OTP secret.'),
  PAYMENT_DRIVER: z.enum(['razorpay','simulation']).optional(),
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_test_[A-Za-z0-9]+$/,'Only Razorpay test keys are supported.').optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
  DELIVERY_KEY: z.string().regex(/^[a-f0-9]{64}$/i, 'Generate a 32-byte hex delivery key.'),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config { return configSchema.parse(process.env); }
