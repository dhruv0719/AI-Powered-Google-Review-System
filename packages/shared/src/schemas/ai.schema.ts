import { z } from 'zod';

export const DraftGenerationRequestSchema = z.object({
  clientDraftId: z
    .string()
    .trim()
    .uuid({ message: 'Client draft ID must be a valid UUID' }),
  feedback: z
    .string()
    .max(2000, { message: 'Feedback payload exceeds maximum allowed size' })
    .optional()
    .default(''),
  rating: z
    .number({ message: 'Experience rating is required' })
    .int({ message: 'Rating must be an integer' })
    .min(1, { message: 'Rating must be between 1 and 5' })
    .max(5, { message: 'Rating must be between 1 and 5' }),
  serviceIds: z
    .array(z.string().uuid({ message: 'Invalid service ID' }))
    .min(1, { message: 'At least one service must be selected' }),
  language: z
    .string()
    .trim()
    .min(2, { message: 'Language code must be at least 2 characters' })
    .max(10, { message: 'Language code cannot exceed 10 characters' })
    .optional(),
});

export type DraftGenerationRequestInput = z.infer<typeof DraftGenerationRequestSchema>;

export const DraftGenerationStatus = {
  GENERATED: 'generated',
  INSUFFICIENT_CONTEXT: 'insufficient_context',
} as const;

export type DraftGenerationStatusType =
  (typeof DraftGenerationStatus)[keyof typeof DraftGenerationStatus];

export const DraftGenerationResponseSchema = z.object({
  status: z.enum(['generated', 'insufficient_context']),
  draft: z.string().nullable(),
  generationsRemaining: z.number().int().min(0).max(3),
  isReplay: z.boolean(),
});

export type DraftGenerationResponseDTO = z.infer<typeof DraftGenerationResponseSchema>;
