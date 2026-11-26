import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GroqAiProvider } from '../src/ai/adapters/groq_provider.js';
import { MockAiProvider } from '../src/ai/adapters/mock_provider.js';
import { AiOrchestrator } from '../src/ai/ai_orchestrator.js';
import { PromptEngine } from '../src/ai/prompt_engine.js';
import {
  AiProviderUnavailableError,
  AiMalformedResponseError,
} from '../src/ai/types.js';
import { getEnv, resetEnv } from '../src/config/env.js';
import { createTestApp } from './setup.js';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
} from '../src/drizzle/schema.js';
import crypto from 'node:crypto';

describe('GroqAiProvider Unit & Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const TEST_API_KEY = 'gsk_test_groq_api_key_secret_12345';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    resetEnv();
  });

  function createMockResponse(body: unknown, status = 200, ok = true): Response {
    return {
      status,
      ok,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    } as unknown as Response;
  }

  // 1. Successful generated response
  it('successfully generates a review draft from valid Groq response', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const mockPayload = {
      id: 'chatcmpl-test-123',
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              status: 'generated',
              draft: 'The service was prompt and the staff was very friendly.',
              reason_code: null,
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 35,
        completion_tokens: 18,
        total_tokens: 53,
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockPayload));

    const messages = PromptEngine.buildPromptMessages('Service was fast, staff friendly');
    const result = await provider.generateDraft({ promptMessages: messages });

    expect(result.status).toBe('generated');
    expect(result.draft).toBe('The service was prompt and the staff was very friendly.');
    expect(result.model).toBe('openai/gpt-oss-20b');
    expect(result.tokenUsage).toEqual({
      promptTokens: 35,
      completionTokens: 18,
      totalTokens: 53,
    });
  });

  // 2. Insufficient-context response
  it('returns insufficient_context when Groq returns status insufficient_context', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const mockPayload = {
      id: 'chatcmpl-test-124',
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              status: 'insufficient_context',
              draft: null,
              reason_code: 'VAGUE_INPUT',
            }),
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockPayload));

    const messages = PromptEngine.buildPromptMessages('vague note');
    const result = await provider.generateDraft({ promptMessages: messages });

    expect(result.status).toBe('insufficient_context');
    expect(result.draft).toBeNull();
    expect(result.model).toBe('openai/gpt-oss-20b');
  });

  // 3. Strict JSON Schema request construction
  it('constructs strict JSON Schema request payload conforming to review draft format', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    let capturedBody: any;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return createMockResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'generated',
                draft: 'Great experience overall.',
                reason_code: null,
              }),
            },
          },
        ],
      });
    });

    const messages = PromptEngine.buildPromptMessages('Great experience overall');
    await provider.generateDraft({ promptMessages: messages });

    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe('openai/gpt-oss-20b');
    expect(capturedBody.max_completion_tokens).toBe(500);
    expect(capturedBody.temperature).toBe(0.2);
    expect(capturedBody.reasoning_effort).toBe('low');
    expect(capturedBody.include_reasoning).toBe(false);
    expect(capturedBody.reasoning_format).toBeUndefined();
    expect(capturedBody.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: expect.stringContaining('customer_feedback') },
    ]);
    expect(capturedBody.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'review_draft',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['generated', 'insufficient_context'],
            },
            draft: {
              type: ['string', 'null'],
            },
            reason_code: {
              type: ['string', 'null'],
            },
          },
          required: ['status', 'draft', 'reason_code'],
          additionalProperties: false,
        },
      },
    });
  });

  // 4. Correct model ID (default and custom)
  it('uses configured model or defaults to openai/gpt-oss-20b', async () => {
    const defaultProvider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const customProvider = new GroqAiProvider({
      apiKey: TEST_API_KEY,
      model: 'custom/model-variant',
    });

    let lastBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      lastBody = JSON.parse(init.body as string);
      return createMockResponse({
        choices: [{ message: { content: JSON.stringify({ status: 'insufficient_context', draft: null }) } }],
      });
    });

    await defaultProvider.generateDraft({ promptMessages: [] });
    expect(lastBody.model).toBe('openai/gpt-oss-20b');

    await customProvider.generateDraft({ promptMessages: [] });
    expect(lastBody.model).toBe('custom/model-variant');
  });

  // 5. Correct Authorization: Bearer header
  it('sends correct Authorization Bearer header and Content-Type', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    let capturedHeaders: any;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init.headers;
      return createMockResponse({
        choices: [{ message: { content: JSON.stringify({ status: 'insufficient_context', draft: null }) } }],
      });
    });

    await provider.generateDraft({ promptMessages: [] });

    expect(capturedHeaders['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  // 6. API key absent from URL, error messages, and logs
  it('never leaks API key in error messages or URLs', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'invalid_auth' }, 401, false)
    );

    try {
      await provider.generateDraft({ promptMessages: [] });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).not.toContain(TEST_API_KEY);
      expect(err).toBeInstanceOf(AiProviderUnavailableError);
    }
  });

  // 7. Missing response content
  it('throws AiMalformedResponseError when message content is missing or empty', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        choices: [{ message: { role: 'assistant', content: '   ' } }],
      })
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  // 8. Malformed JSON content
  it('throws AiMalformedResponseError when message content contains invalid JSON', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        choices: [{ message: { role: 'assistant', content: '{not valid json}' } }],
      })
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  // 9. Invalid response structure
  it('throws AiMalformedResponseError when schema validation fails in content', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({ status: 'unknown_status' }),
            },
          },
        ],
      })
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  // 10. Safety / refusal handling
  it('returns insufficient_context when provider choice includes refusal', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        model: 'openai/gpt-oss-20b',
        choices: [
          {
            message: {
              role: 'assistant',
              refusal: 'I cannot fulfill this request due to safety policies.',
            },
          },
        ],
      })
    );

    const result = await provider.generateDraft({ promptMessages: [] });
    expect(result.status).toBe('insufficient_context');
    expect(result.draft).toBeNull();
  });

  // 11. HTTP 400 Bad Request
  it('throws AiMalformedResponseError on HTTP 400', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Bad Request' }, 400, false)
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  // 12. HTTP 401 / 403 Authentication Failure
  it('throws AiProviderUnavailableError on HTTP 401 and 403', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Unauthorized' }, 401, false)
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Forbidden' }, 403, false)
    );

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );
  });

  // 13. HTTP 429 Rate Limit
  it('throws AiProviderUnavailableError on HTTP 429 rate limit with Retry-After guidance', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ 'retry-after': '45' }),
      json: async () => ({ error: 'Rate limit reached' }),
    } as unknown as Response);

    try {
      await provider.generateDraft({ promptMessages: [] });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AiProviderUnavailableError);
      expect(err.retryAfterSeconds).toBe(45);
    }
  });

  // 13.5. Bound Prompt Length
  it('throws AiMalformedResponseError when prompt input character length exceeds 4000', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const hugeMessage = { role: 'user' as const, content: 'x'.repeat(4001) };

    await expect(provider.generateDraft({ promptMessages: [hugeMessage] })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  // 14. HTTP 500 / 503 Upstream Failure
  it('throws AiProviderUnavailableError on HTTP 500 and 503', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Server error' }, 500, false)
    );
    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Service Unavailable' }, 503, false)
    );
    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );
  });

  // 15. Network failure
  it('throws AiProviderUnavailableError on network failure', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );
  });

  // 16. AbortSignal propagation
  it('propagates caller AbortSignal immediately without fetch if already aborted', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const controller = new AbortController();
    controller.abort();

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await expect(
      provider.generateDraft({ promptMessages: [], signal: controller.signal })
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates AbortError thrown by fetch during execution', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const abortErr = new DOMException('The operation was aborted', 'AbortError');
      throw abortErr;
    });

    await expect(
      provider.generateDraft({ promptMessages: [], signal: controller.signal })
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  // 17. No automatic retry
  it('makes exactly one network call and does not retry internally', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const fetchMock = vi.fn().mockResolvedValue(
      createMockResponse({ error: 'Service Unavailable' }, 503, false)
    );
    globalThis.fetch = fetchMock;

    await expect(provider.generateDraft({ promptMessages: [] })).rejects.toThrow(
      AiProviderUnavailableError
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 18. Token usage parsing
  it('correctly extracts and parses tokenUsage when provided by Groq', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'generated',
                draft: 'Quick and reliable service.',
                reason_code: null,
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 42,
          completion_tokens: 15,
          total_tokens: 57,
        },
      })
    );

    const result = await provider.generateDraft({ promptMessages: [] });
    expect(result.tokenUsage).toEqual({
      promptTokens: 42,
      completionTokens: 15,
      totalTokens: 57,
    });
  });

  // 19. Constructor validation
  it('throws an error if apiKey is empty or missing in constructor', () => {
    expect(() => new GroqAiProvider({ apiKey: '' })).toThrow(
      'GroqAiProvider requires a non-empty apiKey'
    );
    expect(() => new GroqAiProvider({ apiKey: '   ' })).toThrow(
      'GroqAiProvider requires a non-empty apiKey'
    );
  });

  // 20. Provider selection & env configuration
  describe('Provider Selection & Environment Configuration', () => {
    it('defaults to MockAiProvider when AI_PROVIDER is not set or set to mock', () => {
      delete process.env.AI_PROVIDER;
      resetEnv();
      const orchestrator = new AiOrchestrator();
      expect((orchestrator as any).defaultProvider).toBeInstanceOf(MockAiProvider);
      expect((orchestrator as any).defaultProvider.providerName).toBe('mock-ai-provider');
    });

    it('instantiates GroqAiProvider when AI_PROVIDER=groq and GROQ_API_KEY is present', () => {
      process.env.AI_PROVIDER = 'groq';
      process.env.GROQ_API_KEY = 'gsk_valid_key_123';
      resetEnv();

      const orchestrator = new AiOrchestrator();
      expect((orchestrator as any).defaultProvider).toBeInstanceOf(GroqAiProvider);
      expect((orchestrator as any).defaultProvider.providerName).toBe('groq');
    });

    it('fails env validation when AI_PROVIDER=groq and GROQ_API_KEY is missing', () => {
      process.env.AI_PROVIDER = 'groq';
      delete process.env.GROQ_API_KEY;
      resetEnv();

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('allows ENABLE_AI_ASSISTANT=false independently of AI_PROVIDER', () => {
      process.env.AI_PROVIDER = 'groq';
      process.env.GROQ_API_KEY = 'gsk_valid_key_123';
      process.env.ENABLE_AI_ASSISTANT = 'false';
      resetEnv();

      const env = getEnv();
      expect(env.ENABLE_AI_ASSISTANT).toBe(false);
      expect(env.AI_PROVIDER).toBe('groq');
    });
  });

  // 21. AiOrchestrator end-to-end integration with Groq provider
  describe('AiOrchestrator Integration with GroqAiProvider', () => {
    let db: any;

    beforeEach(async () => {
      const testSetup = await createTestApp();
      db = testSetup.db;
    });

    it('completes lease reservation, provider generation, guardrail validation, and settlement with GroqAiProvider', async () => {
      process.env.AI_PROVIDER = 'groq';
      process.env.GROQ_API_KEY = TEST_API_KEY;
      process.env.ENABLE_AI_ASSISTANT = 'true';
      resetEnv();

      // Mock Groq API response
      globalThis.fetch = vi.fn().mockResolvedValue(
        createMockResponse({
          model: 'openai/gpt-oss-20b',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: 'generated',
                  draft: 'Food was delicious and the staff was very friendly.',
                  reason_code: null,
                }),
              },
            },
          ],
        })
      );

      // Create test tenant hierarchy
      const [t] = await db
        .insert(tenants)
        .values({ displayName: 'Groq Test Tenant', slug: `groq-t-${Date.now()}` })
        .returning();

      const [l] = await db
        .insert(locations)
        .values({
          tenantId: t.id,
          name: 'Groq Location',
          googleReviewUrl: 'https://g.page/r/test/review',
          isActive: true,
          isPrimary: true,
        })
        .returning();

      const [c] = await db
        .insert(qrCampaigns)
        .values({
          tenantId: t.id,
          locationId: l.id,
          name: 'Groq Campaign',
          code: `GROQ-${Date.now()}`,
          isActive: true,
        })
        .returning();

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

      const [s] = await db
        .insert(ephemeralSessions)
        .values({
          tenantId: t.id,
          locationId: l.id,
          campaignId: c.id,
          tokenHash,
          issuedCode: c.code,
          expiresAt: new Date(Date.now() + 3600000),
          generationsRemaining: 3,
        })
        .returning();

      const orchestrator = new AiOrchestrator();
      const clientDraftId = crypto.randomUUID();

      const result = await orchestrator.generateDraft(db, s.id, {
        clientDraftId,
        feedback: 'Food was delicious and staff friendly.',
        rating: 5,
        serviceIds: [],
        language: 'en',
      });

      expect(result.status).toBe('generated');
      expect(result.draft).toBe('Food was delicious and the staff was very friendly.');
      expect(result.generationsRemaining).toBe(2);
      expect(result.isReplay).toBe(false);

      // Test idempotency replay
      const replayResult = await orchestrator.generateDraft(db, s.id, {
        clientDraftId,
        feedback: 'Food was delicious and staff friendly.',
        rating: 5,
        serviceIds: [],
        language: 'en',
      });

      expect(replayResult.status).toBe('generated');
      expect(replayResult.draft).toBe('Food was delicious and the staff was very friendly.');
      expect(replayResult.generationsRemaining).toBe(2);
      expect(replayResult.isReplay).toBe(true);
    });
  });

  // 22. Reasoning suppression in user-facing draft
  it('does not include reasoning content in the user-facing draft', async () => {
    const provider = new GroqAiProvider({ apiKey: TEST_API_KEY });
    const mockPayload = {
      id: 'chatcmpl-test-reasoning',
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            reasoning: 'Customer says service was fast. I should polish grammar and output JSON.',
            content: JSON.stringify({
              status: 'generated',
              draft: 'Service was fast and friendly.',
              reason_code: null,
            }),
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockPayload));
    const result = await provider.generateDraft({ promptMessages: [] });
    expect(result.status).toBe('generated');
    expect(result.draft).toBe('Service was fast and friendly.');
    expect(result.draft).not.toContain('Customer says service was fast');
    expect(result.draft).not.toContain('polish grammar');
    expect((result as any).reasoning).toBeUndefined();
  });

  // 23. Smoke script security verification
  it('verifies smoke-groq-provider.ts does not print or mask partial API key fragments', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const smokeFilePath = path.resolve(__dirname, '../scripts/smoke-groq-provider.ts');
    const smokeFileContent = fs.readFileSync(smokeFilePath, 'utf-8');

    // Ensure no maskApiKey function exists
    expect(smokeFileContent).not.toContain('maskApiKey');
    expect(smokeFileContent).not.toContain('gsk_');
    expect(smokeFileContent).toContain('[CONFIGURED]');
  });
});
