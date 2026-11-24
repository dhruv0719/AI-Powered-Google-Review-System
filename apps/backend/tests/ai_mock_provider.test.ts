import { describe, it, expect } from 'vitest';
import { MockAiProvider } from '../src/ai/adapters/mock_provider';
import { PromptEngine } from '../src/ai/prompt_engine';
import { OutputValidationPipeline } from '../src/ai/output_validator';
import {
  AiProviderTimeoutError,
  AiProviderUnavailableError,
  AiMalformedResponseError,
} from '../src/ai/types';

describe('MockAiProvider Unit Tests', () => {
  it('generates a clean polished draft without meta-text in SUCCESS mode', async () => {
    const provider = new MockAiProvider('SUCCESS');
    const sourceFeedback = 'service was fast, staff courteous';
    const messages = PromptEngine.buildPromptMessages(sourceFeedback);

    const result = await provider.generateDraft({ promptMessages: messages });
    expect(result.status).toBe('generated');
    expect(result.draft).toBeTruthy();

    // Verify draft passes OutputValidationPipeline without meta-text or errors
    const valResult = OutputValidationPipeline.validate(result.draft!, sourceFeedback);
    expect(valResult.isValid).toBe(true);
  });

  it('returns status insufficient_context with null draft in INSUFFICIENT_CONTEXT mode', async () => {
    const provider = new MockAiProvider('INSUFFICIENT_CONTEXT');
    const messages = PromptEngine.buildPromptMessages('vague feedback');

    const result = await provider.generateDraft({ promptMessages: messages });
    expect(result.status).toBe('insufficient_context');
    expect(result.draft).toBeNull();
  });

  it('throws typed AiProviderTimeoutError in TIMEOUT mode', async () => {
    const provider = new MockAiProvider('TIMEOUT');
    const messages = PromptEngine.buildPromptMessages('feedback');

    await expect(provider.generateDraft({ promptMessages: messages })).rejects.toThrow(
      AiProviderTimeoutError
    );
  });

  it('throws typed AiProviderUnavailableError in PROVIDER_5XX mode', async () => {
    const provider = new MockAiProvider('PROVIDER_5XX');
    const messages = PromptEngine.buildPromptMessages('feedback');

    await expect(provider.generateDraft({ promptMessages: messages })).rejects.toThrow(
      AiProviderUnavailableError
    );
  });

  it('throws typed AiMalformedResponseError in MALFORMED_OUTPUT mode', async () => {
    const provider = new MockAiProvider('MALFORMED_OUTPUT');
    const messages = PromptEngine.buildPromptMessages('feedback');

    await expect(provider.generateDraft({ promptMessages: messages })).rejects.toThrow(
      AiMalformedResponseError
    );
  });

  it('rejects immediately with AbortError when AbortSignal is cancelled', async () => {
    const provider = new MockAiProvider('SUCCESS');
    const messages = PromptEngine.buildPromptMessages('feedback');
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateDraft({ promptMessages: messages, signal: controller.signal })
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  describe('Guardrail Simulation Modes against OutputValidationPipeline', () => {
    it('simulates ungrounded numeric entity and fails output validation', async () => {
      const provider = new MockAiProvider('UNGROUNDED_NUMERIC');
      const source = 'We liked the service.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('simulates ungrounded unit change and fails output validation', async () => {
      const provider = new MockAiProvider('UNGROUNDED_UNIT');
      const source = 'We waited 2 hours for the technician.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('simulates sentiment inversion and fails output validation', async () => {
      const provider = new MockAiProvider('SENTIMENT_INVERTED');
      const source = 'Food was terrible and staff was very rude.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('SENTIMENT_INVERSION_DETECTED');
      }
    });

    it('simulates prohibited external URL and fails output validation', async () => {
      const provider = new MockAiProvider('PROHIBITED_URL');
      const source = 'Service was fine.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('PROHIBITED_URL_DETECTED');
      }
    });

    it('simulates meta-text preamble and fails output validation', async () => {
      const provider = new MockAiProvider('META_TEXT_LEAK');
      const source = 'Service was fine.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('META_TEXT_DETECTED');
      }
    });

    it('simulates placeholder leakage and fails output validation', async () => {
      const provider = new MockAiProvider('PLACEHOLDER_LEAK');
      const source = 'Contact us for details.';
      const messages = PromptEngine.buildPromptMessages(source);

      const result = await provider.generateDraft({ promptMessages: messages });
      const valResult = OutputValidationPipeline.validate(result.draft!, source);
      expect(valResult.isValid).toBe(false);
      if (!valResult.isValid) {
        expect(valResult.reasonCode).toBe('PROHIBITED_PLACEHOLDER_LEAK');
      }
    });
  });
});
