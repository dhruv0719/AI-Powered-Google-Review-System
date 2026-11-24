import { AiGenerationResult, AiMalformedResponseError } from '../types.js';

export function parseProviderResponse(
  raw: unknown,
  defaultModel = 'mock-model'
): AiGenerationResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new AiMalformedResponseError('Provider returned non-object response', raw);
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.status === 'insufficient_context') {
    return {
      status: 'insufficient_context',
      draft: null,
      model: typeof candidate.model === 'string' ? candidate.model : defaultModel,
    };
  }

  if (candidate.status === 'generated') {
    if (typeof candidate.draft !== 'string' || candidate.draft.trim().length === 0) {
      throw new AiMalformedResponseError(
        'Status is generated but draft is missing or empty',
        raw
      );
    }

    const tokenUsage =
      typeof candidate.tokenUsage === 'object' && candidate.tokenUsage !== null
        ? (candidate.tokenUsage as AiGenerationResult['tokenUsage'])
        : undefined;

    return {
      status: 'generated',
      draft: candidate.draft.trim(),
      model: typeof candidate.model === 'string' ? candidate.model : defaultModel,
      tokenUsage,
    };
  }

  throw new AiMalformedResponseError(
    `Invalid or missing status '${String(candidate.status)}' in provider response`,
    raw
  );
}
