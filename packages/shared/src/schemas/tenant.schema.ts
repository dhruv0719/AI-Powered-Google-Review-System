import { z } from 'zod';

export const CreateTenantSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, { message: 'Business name must be at least 2 characters' })
      .max(150),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]+$/, {
        message: 'Slug must contain only lowercase alphanumeric characters and hyphens',
      })
      .min(2)
      .max(100)
      .optional(),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Invalid hex color' })
      .optional(),
    logoUrl: z.string().url().max(512).optional(),
  })
  .strict();

export const SwitchTenantSchema = z
  .object({
    tenantId: z.string().uuid({ message: 'Invalid tenant ID' }),
  })
  .strict();

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type SwitchTenantInput = z.infer<typeof SwitchTenantSchema>;
