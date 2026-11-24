import {
  PublicQRResolutionDTO,
  PublicSessionResponseDTO,
  CreatePrivateFeedbackInput,
  DraftGenerationRequestInput,
  DraftGenerationResponseDTO,
} from '@review-system/shared';

const API_BASE = '/api/v1';

export class PublicApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, statusCode?: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'PublicApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function publicRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data?.error?.message || `Request failed with status ${res.status}`;
    throw new PublicApiError(errorMsg, res.status, data?.error?.code, data?.error?.details);
  }

  return data as T;
}

export const publicApi = {
  resolvePublicCampaign: (code: string): Promise<PublicQRResolutionDTO> =>
    publicRequest<PublicQRResolutionDTO>(`/public/qr/${encodeURIComponent(code)}`),

  createPublicSession: (code: string): Promise<PublicSessionResponseDTO> =>
    publicRequest<PublicSessionResponseDTO>(`/public/qr/${encodeURIComponent(code)}/sessions`, {
      method: 'POST',
    }),

  submitPublicFeedback: (
    code: string,
    data: CreatePrivateFeedbackInput
  ): Promise<{ success: boolean; feedbackId: string; message: string }> =>
    publicRequest<{ success: boolean; feedbackId: string; message: string }>(
      `/public/qr/${encodeURIComponent(code)}/feedback`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  generateAiDraft: (
    code: string,
    data: DraftGenerationRequestInput
  ): Promise<DraftGenerationResponseDTO> =>
    publicRequest<DraftGenerationResponseDTO>(
      `/public/qr/${encodeURIComponent(code)}/generate-draft`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
};
