import { AiAssistantConstants } from '@review-system/shared';

export { AiAssistantConstants };

/**
 * Maximum permitted grapheme count for a generated review draft.
 * Allows up to 20% natural grammar/spelling expansion over MAX_FEEDBACK_LENGTH (500).
 */
export const MAX_DRAFT_LENGTH = 600;

export interface ValidationSuccess {
  isValid: true;
  graphemeCount: number;
  wordCount: number;
}

export interface ValidationFailure {
  isValid: false;
  reasonCode:
    | 'INPUT_TOO_SHORT'
    | 'INPUT_TOO_LONG'
    | 'INSUFFICIENT_WORDS'
    | 'REPEATED_GRAPHEME_FLOOD'
    | 'LOW_CHARACTER_DIVERSITY'
    | 'LATIN_KEYBOARD_MASH';
  message: string;
}

export type InputValidationResult = ValidationSuccess | ValidationFailure;

export interface OutputValidationSuccess {
  isValid: true;
  graphemeCount: number;
  draft: string;
}

export interface OutputValidationFailure {
  isValid: false;
  reasonCode:
    | 'MALFORMED_PROVIDER_OUTPUT'
    | 'OUTPUT_TOO_SHORT'
    | 'OUTPUT_TOO_LONG'
    | 'UNGROUNDED_NUMERIC_ENTITY'
    | 'SENTIMENT_INVERSION_DETECTED'
    | 'META_TEXT_DETECTED'
    | 'PROHIBITED_URL_DETECTED'
    | 'PROHIBITED_PLACEHOLDER_LEAK'
    | 'INSTRUCTION_LEAKAGE_DETECTED';
  message: string;
}

export type OutputValidationResult = OutputValidationSuccess | OutputValidationFailure;

export interface AiPromptMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiGenerationOptions {
  promptMessages: AiPromptMessage[];
  language?: string;
  signal?: AbortSignal;
}

export interface AiGenerationResult {
  status: 'generated' | 'insufficient_context';
  draft: string | null;
  model: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// --- Typed Errors ---

export class AiProviderTimeoutError extends Error {
  public readonly code = 'AI_PROVIDER_TIMEOUT';
  constructor(message = 'AI provider request timed out') {
    super(message);
    this.name = 'AiProviderTimeoutError';
  }
}

export class AiProviderUnavailableError extends Error {
  public readonly code = 'AI_PROVIDER_UNAVAILABLE';
  constructor(
    message = 'AI provider is unavailable or rate limited',
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AiProviderUnavailableError';
  }
}

export class AiMalformedResponseError extends Error {
  public readonly code = 'MALFORMED_PROVIDER_OUTPUT';
  constructor(message: string, public readonly rawPayload?: unknown) {
    super(message);
    this.name = 'AiMalformedResponseError';
  }
}
