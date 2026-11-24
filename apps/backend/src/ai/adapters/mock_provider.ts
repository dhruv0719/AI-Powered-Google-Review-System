import { AiProvider } from './ai_provider.interface.js';
import {
  AiGenerationOptions,
  AiGenerationResult,
  AiPromptMessage,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
} from '../types.js';
import { parseProviderResponse } from './response_parser.js';

export type MockBehaviorMode =
  | 'SUCCESS'
  | 'INSUFFICIENT_CONTEXT'
  | 'TIMEOUT'
  | 'PROVIDER_5XX'
  | 'MALFORMED_OUTPUT'
  | 'UNGROUNDED_NUMERIC'
  | 'UNGROUNDED_UNIT'
  | 'SENTIMENT_INVERTED'
  | 'PROHIBITED_URL'
  | 'META_TEXT_LEAK'
  | 'PLACEHOLDER_LEAK';

export class MockAiProvider implements AiProvider {
  public readonly providerName = 'mock-ai-provider';
  private mode: MockBehaviorMode = 'SUCCESS';
  private customDraftHandler?: (options: AiGenerationOptions) => string;

  constructor(initialMode: MockBehaviorMode = 'SUCCESS') {
    this.mode = initialMode;
  }

  public setMode(mode: MockBehaviorMode): void {
    this.mode = mode;
  }

  public setCustomDraftHandler(handler: (options: AiGenerationOptions) => string): void {
    this.customDraftHandler = handler;
  }

  public async generateDraft(options: AiGenerationOptions): Promise<AiGenerationResult> {
    // 1. Cancellation check
    if (options.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }

    // 2. Mode simulation
    switch (this.mode) {
      case 'TIMEOUT':
        throw new AiProviderTimeoutError('Simulated provider timeout');

      case 'PROVIDER_5XX':
        throw new AiProviderUnavailableError('Simulated provider 503 unavailable');

      case 'MALFORMED_OUTPUT': {
        // Simulates provider returning an invalid structure
        return parseProviderResponse({ status: 'generated', draft: '' }, 'mock-v1');
      }

      case 'INSUFFICIENT_CONTEXT':
        return parseProviderResponse(
          {
            status: 'insufficient_context',
            draft: null,
            model: 'mock-v1',
          },
          'mock-v1'
        );

      case 'UNGROUNDED_NUMERIC': {
        const text = this.extractSourceText(options);
        return parseProviderResponse(
          {
            status: 'generated',
            draft: `${text} We were charged $500 extra.`,
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'UNGROUNDED_UNIT': {
        return parseProviderResponse(
          {
            status: 'generated',
            draft: 'We waited 2 days for the technician.',
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'SENTIMENT_INVERTED': {
        return parseProviderResponse(
          {
            status: 'generated',
            draft: 'Outstanding experience! Everything was wonderful, highly recommend!',
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'PROHIBITED_URL': {
        const text = this.extractSourceText(options);
        return parseProviderResponse(
          {
            status: 'generated',
            draft: `${text} Visit our blog at https://spam-link.example.com`,
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'META_TEXT_LEAK': {
        const text = this.extractSourceText(options);
        return parseProviderResponse(
          {
            status: 'generated',
            draft: `Here is your review: ${text}`,
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'PLACEHOLDER_LEAK': {
        return parseProviderResponse(
          {
            status: 'generated',
            draft: 'Please contact us at [PHONE] for assistance.',
            model: 'mock-v1',
          },
          'mock-v1'
        );
      }

      case 'SUCCESS':
      default: {
        if (this.customDraftHandler) {
          return parseProviderResponse(
            {
              status: 'generated',
              draft: this.customDraftHandler(options),
              model: 'mock-v1',
            },
            'mock-v1'
          );
        }

        const source = this.extractSourceText(options);
        // Clean default polish: trim and ensure ending period
        const trimmed = source.trim();
        const polished = trimmed.endsWith('.') ? trimmed : `${trimmed}.`;

        return parseProviderResponse(
          {
            status: 'generated',
            draft: polished,
            model: 'mock-v1',
            tokenUsage: {
              promptTokens: 25,
              completionTokens: 20,
              totalTokens: 45,
            },
          },
          'mock-v1'
        );
      }
    }
  }

  private extractSourceText(options: AiGenerationOptions): string {
    const userMsg = options.promptMessages.find((m: AiPromptMessage) => m.role === 'user');
    if (!userMsg) return 'Clean feedback text.';
    try {
      // Find JSON block inside user message
      const jsonStart = userMsg.content.indexOf('{');
      if (jsonStart !== -1) {
        const parsed = JSON.parse(userMsg.content.slice(jsonStart));
        if (typeof parsed.customer_feedback === 'string') {
          return parsed.customer_feedback;
        }
      }
    } catch {
      // Fallback
    }
    return userMsg.content;
  }
}
