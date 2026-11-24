import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z
      .string()
      .min(32, { message: 'SESSION_SECRET must be at least 32 characters long' })
      .default('super-secret-session-key-must-be-at-least-32-chars-long!'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
    TRUSTED_PROXIES: z.string().default('127.0.0.1,::1'),
    ENABLE_AI_ASSISTANT: z
      .string()
      .optional()
      .default('false')
      .transform((val) => val.trim().toLowerCase() === 'true'),
    AI_PROVIDER: z.enum(['mock', 'groq']).default('mock'),
    AI_MODEL: z.string().default('openai/gpt-oss-20b'),
    GROQ_API_KEY: z.string().optional(),
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
