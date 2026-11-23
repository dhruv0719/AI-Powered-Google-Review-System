import { z } from 'zod';
import { isValidGoogleReviewUrl } from '../utils/google_url.js';

export const GoogleReviewUrlSchema = z
  .string()
  .trim()
  .max(1024, { message: 'URL cannot exceed 1024 characters' })
  .refine(
    (val) => isValidGoogleReviewUrl(val),
    {
      message:
        'Must be a valid HTTPS Google Review URL (e.g. https://g.page/r/.../review or https://search.google.com/local/writereview?placeid=...). Note: Structural validation does not guarantee destination exists on Google.',
    }
  );

export const CreateLocationSchema = z.object({
  name: z.string().trim().min(2, { message: 'Location name must be at least 2 characters' }).max(150),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  googleReviewUrl: GoogleReviewUrlSchema.optional().nullable(),
  isPrimary: z.boolean().optional(),
});

export type CreateLocationInput = z.infer<typeof CreateLocationSchema>;

export const UpdateLocationSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  googleReviewUrl: GoogleReviewUrlSchema.optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  newPrimaryLocationId: z.string().uuid({ message: 'newPrimaryLocationId must be a valid UUID' }).optional(),
});

export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;
