import { z } from 'zod';

export const CreateServiceSchema = z.object({
  name: z.string().trim().min(2, { message: 'Service name must be at least 2 characters' }).max(100),
  description: z.string().trim().max(255).optional().nullable(),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(255).optional().nullable(),
  displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;
