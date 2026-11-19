import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

    SUPABASE_URL: z.url(),
    /** Only for projects still on the legacy shared secret. Asymmetric keys use JWKS. */
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),

    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    PAYMENT_PROVIDER: z.enum(['razorpay', 'mock']).default('razorpay'),
    /** Lets the simulated checkout run in production while Razorpay is not set up yet. */
    ALLOW_DEMO_PAYMENTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),

    /** Supabase Storage for photos and videos. Without it, files are kept on local disk. */
    SUPABASE_SECRET_KEY: z.string().min(10).optional(),
    STORAGE_BUCKET: z.string().default('reomi-media'),
    /** Where local-disk uploads are served from, in development. */
    PUBLIC_API_URL: z.url().optional(),
    MEDIA_DIR: z.string().default('.local/media'),
    MEDIA_SIGNING_SECRET: z.string().min(16).optional(),
    /** The minute-by-minute notifier. Tests turn it off and call it directly. */
    SWEEPER: z
      .enum(['on', 'off'])
      .default('on')
      .transform((value) => value === 'on'),

    /** How long an accepted applicant holds a seat before it is released. */
    PAYMENT_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock' && !env.ALLOW_DEMO_PAYMENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'The mock payment provider needs ALLOW_DEMO_PAYMENTS=true in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
      }
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Required in production' });
    }
  });

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};
