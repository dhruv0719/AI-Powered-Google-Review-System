import { describe, it, expect } from 'vitest';
import { parseProviderResponse } from '../src/ai/adapters/response_parser';
import { AiMalformedResponseError } from '../src/ai/types';

describe('ResponseParser Unit Tests', () => {
  it('parses valid generated response with draft and token usage', () => {
    const raw = {
      status: 'generated',
      draft: 'The service was very fast and courteous.',
      model: 'test-model-v1',
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 15,
        totalTokens: 35,
      },
    };

    const res = parseProviderResponse(raw);
    expect(res.status).toBe('generated');
    expect(res.draft).toBe('The service was very fast and courteous.');
    expect(res.model).toBe('test-model-v1');
    expect(res.tokenUsage?.totalTokens).toBe(35);
  });

  it('parses valid insufficient_context response with null draft', () => {
    const raw = {
      status: 'insufficient_context',
      draft: null,
      model: 'test-model-v1',
    };

    const res = parseProviderResponse(raw);
    expect(res.status).toBe('insufficient_context');
    expect(res.draft).toBeNull();
  });

  it('throws AiMalformedResponseError on non-object or null input', () => {
    expect(() => parseProviderResponse(null)).toThrow(AiMalformedResponseError);
    expect(() => parseProviderResponse('invalid string')).toThrow(AiMalformedResponseError);
    expect(() => parseProviderResponse(12345)).toThrow(AiMalformedResponseError);
  });

  it('throws AiMalformedResponseError when status is generated but draft is missing or empty', () => {
    expect(() => parseProviderResponse({ status: 'generated', draft: '' })).toThrow(
      AiMalformedResponseError
    );
    expect(() => parseProviderResponse({ status: 'generated', draft: '   ' })).toThrow(
      AiMalformedResponseError
    );
    expect(() => parseProviderResponse({ status: 'generated' })).toThrow(
      AiMalformedResponseError
    );
  });

  it('throws AiMalformedResponseError on unrecognized status values', () => {
    expect(() =>
      parseProviderResponse({ status: 'unknown_status', draft: 'Some draft' })
    ).toThrow(AiMalformedResponseError);
  });
});
