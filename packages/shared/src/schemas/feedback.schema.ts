import { z } from 'zod';

export const CreatePrivateFeedbackSchema = z.object({
  rating: z
    .number()
    .int({ message: 'Rating must be an integer' })
    .min(1, { message: 'Rating must be at least 1' })
    .max(5, { message: 'Rating cannot exceed 5' }),
  serviceIds: z.array(z.string().uuid({ message: 'Invalid service ID' })).optional().default([]),
  feedbackText: z
    .string()
    .trim()
    .min(3, { message: 'Feedback text must be at least 3 characters if provided' })
    .max(1000, { message: 'Feedback text cannot exceed 1000 characters' })
    .nullable()
    .optional(),
  customerContact: z
    .string()
    .trim()
    .max(100, { message: 'Contact details cannot exceed 100 characters' })
    .nullable()
    .optional(),
  consentGiven: z.literal(true, {
    message: 'Explicit affirmative consent is required to submit private feedback',
  }),
});

export type CreatePrivateFeedbackInput = z.infer<typeof CreatePrivateFeedbackSchema>;

export const UpdateFeedbackStatusSchema = z.object({
  status: z.enum(['reviewed', 'archived']),
});

export type UpdateFeedbackStatusInput = z.infer<typeof UpdateFeedbackStatusSchema>;

export const FeedbackQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  status: z.enum(['new', 'reviewed', 'archived', 'all']).optional().default('new'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type FeedbackQueryInput = z.infer<typeof FeedbackQuerySchema>;
