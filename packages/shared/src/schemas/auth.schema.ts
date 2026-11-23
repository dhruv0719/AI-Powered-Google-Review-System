import { z } from 'zod';
import { AuthConstants } from '../constants/index.js';

export const RegisterSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email({ message: 'Invalid email address' })
      .max(255),
    password: z
      .string()
      .min(AuthConstants.MIN_PASSWORD_LENGTH, {
        message: `Password must be at least ${AuthConstants.MIN_PASSWORD_LENGTH} characters`,
      })
      .max(128),
    fullName: z
      .string()
      .trim()
      .min(2, { message: 'Full name must be at least 2 characters' })
      .max(100),
    businessName: z
      .string()
      .trim()
      .min(2, { message: 'Business name must be at least 2 characters' })
      .max(150),
  })
  .strict();

export const LoginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email({ message: 'Invalid email address' })
      .max(255),
    password: z.string().min(1, { message: 'Password is required' }),
  })
  .strict();

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
