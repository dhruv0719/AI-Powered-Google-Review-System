import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().optional(),
    MIGRATION_DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z
      .string()
      .min(32, { message: 'SESSION_SECRET must be at least 32 characters long' })
      .default('super-secret-session-key-must-be-at-least-32-chars-long!'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((val) => {
        if (val !== undefined && val.trim().length > 0) {
          return val.trim().toLowerCase() === 'true';
        }
        return process.env.NODE_ENV === 'production';
      }),
    PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
    ALLOWED_ORIGINS: z.string().optional(),
    TRUSTED_PROXIES: z.string().default('127.0.0.1,::1'),
    ENABLE_AI_ASSISTANT: z
      .string()
      .optional()
      .default('false')
      .transform((val) => val.trim().toLowerCase() === 'true'),
    AI_PROVIDER: z.enum(['mock', 'groq']).default('mock'),
    AI_MODEL: z.string().default('openai/gpt-oss-20b'),
    GROQ_API_KEY: z.string().optional(),
    INTERNAL_PROXY_SECRET: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.AI_PROVIDER === 'groq') {
        return typeof data.GROQ_API_KEY === 'string' && data.GROQ_API_KEY.trim().length > 0;
      }
      return true;
    },
    {
      message: 'GROQ_API_KEY is required when AI_PROVIDER is set to "groq"',
      path: ['GROQ_API_KEY'],
    }
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const rawSecret = process.env.SESSION_SECRET;
        if (rawSecret === undefined) {
          return false;
        }
        const trimmedSecret = rawSecret.trim();
        const DEFAULT_SECRET = 'super-secret-session-key-must-be-at-least-32-chars-long!';
        return (
          trimmedSecret.length >= 32 &&
          trimmedSecret !== DEFAULT_SECRET
        );
      }
      return true;
    },
    {
      message: 'SESSION_SECRET must be explicitly set to a non-default secret of at least 32 characters in production',
      path: ['SESSION_SECRET'],
    }
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const rawProxySecret = process.env.INTERNAL_PROXY_SECRET;
        if (rawProxySecret === undefined) {
          return false;
        }
        const trimmed = rawProxySecret.trim();
        return trimmed.length >= 32;
      }
      return true;
    },
    {
      message: 'INTERNAL_PROXY_SECRET must be explicitly set to a secret of at least 32 characters in production',
      path: ['INTERNAL_PROXY_SECRET'],
    }
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const rawDbUrl = process.env.DATABASE_URL;
        return typeof rawDbUrl === 'string' && rawDbUrl.trim().length > 0;
      }
      return true;
    },
    {
      message: 'DATABASE_URL must be explicitly set to a pooled PostgreSQL connection URI in production',
      path: ['DATABASE_URL'],
    }
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const rawMigrationUrl = process.env.MIGRATION_DATABASE_URL;
        if (!rawMigrationUrl || rawMigrationUrl.trim().length === 0) {
          return false;
        }
        if (rawMigrationUrl.includes('-pooler')) {
          return false;
        }
        return true;
      }
      return true;
    },
    {
      message: 'MIGRATION_DATABASE_URL must be explicitly set to a direct (non-pooled) PostgreSQL connection URI in production and must not use a pooler endpoint (-pooler)',
      path: ['MIGRATION_DATABASE_URL'],
    }
  );

export type Env = z.infer<typeof EnvSchema>;

let envInstance: Env | null = null;

export function getEnv(): Env {
  if (!envInstance) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:', result.error.format());
      throw new Error('Environment variable validation failed');
    }
    envInstance = result.data;
  }
  return envInstance;
}

export function resetEnv(): void {
  envInstance = null;
}
