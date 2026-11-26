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

export interface ColdStartProgress {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  isColdStart: boolean;
}

export interface ResolveCampaignOptions {
  signal?: AbortSignal;
  retryDelays?: number[];
  onProgress?: (info: ColdStartProgress) => void;
}

/**
 * Standard cold-start backoff schedule covering Render's ~60-75s boot time.
 * Total retry delay: 4s + 8s + 15s + 20s + 25s = 72 seconds across 6 total attempts.
 */
export const DEFAULT_COLD_START_DELAYS = [4000, 8000, 15000, 20000, 25000];

/**
 * Determines whether an error is a transient upstream network or gateway failure
 * (502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout, or network drop)
 * indicative of a backend cold start.
 * Explicitly excludes client/validation errors (400, 403, 404, 429).
 */
export function isTransientColdStartError(err: unknown): boolean {
  if (err instanceof PublicApiError) {
    return err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504;
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('networkerror') || msg.includes('failed to fetch') || msg.includes('load failed');
  }
  return false;
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

async function resolvePublicCampaignWithRetry(
  code: string,
  options?: ResolveCampaignOptions
): Promise<PublicQRResolutionDTO> {
  const delays = options?.retryDelays ?? DEFAULT_COLD_START_DELAYS;
  const maxAttempts = delays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    try {
      const result = await publicRequest<PublicQRResolutionDTO>(
        `/public/qr/${encodeURIComponent(code)}`,
        { signal: options?.signal }
      );
      return result;
    } catch (err: unknown) {
      if (options?.signal?.aborted) {
        throw err;
      }

      const isColdStart = isTransientColdStartError(err);
      const hasMoreAttempts = attempt < maxAttempts;

      if (!isColdStart || !hasMoreAttempts) {
        throw err;
      }

      const baseDelay = delays[attempt - 1] ?? 5000;
      // Add ±10% jitter to prevent synchronized retry waves
      const jitter = Math.floor((Math.random() * 0.2 - 0.1) * baseDelay);
      const delayMs = Math.max(100, baseDelay + jitter);

      if (options?.onProgress) {
        options.onProgress({
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          isColdStart: true,
        });
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        if (options?.signal) {
          const abortHandler = () => {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abortHandler);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          };
          options.signal.addEventListener('abort', abortHandler, { once: true });
        }
      });
    }
  }

  throw new PublicApiError('Review service is currently unavailable. Please try again.', 503);
}

export const publicApi = {
  resolvePublicCampaign: (
    code: string,
    options?: ResolveCampaignOptions
  ): Promise<PublicQRResolutionDTO> =>
    resolvePublicCampaignWithRetry(code, options),

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
