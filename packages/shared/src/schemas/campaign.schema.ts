import { z } from 'zod';

export const CampaignCodeSchema = z
  .string()
  .regex(/^q_[A-Za-z0-9_-]{22}$/, { message: 'Invalid QR campaign code format. Must be a 24-character Base64url token prefixed with q_' });

export const CreateCampaignSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Campaign name cannot be empty' })
    .max(100, { message: 'Campaign name cannot exceed 100 characters' }),
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Campaign name cannot be empty' })
      .max(100, { message: 'Campaign name cannot exceed 100 characters' })
      .optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((data) => data.name !== undefined || data.status !== undefined, {
    message: 'At least one field (name or status) must be provided for update',
  });

export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;
