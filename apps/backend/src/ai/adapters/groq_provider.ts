import { AiProvider } from './ai_provider.interface.js';
import {
  AiGenerationOptions,
  AiGenerationResult,
  AiMalformedResponseError,
  AiProviderUnavailableError,
} from '../types.js';
import { parseProviderResponse } from './response_parser.js';

export interface GroqAiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

/**
 * Production AI Provider for Groq OpenAI-compatible Chat Completions API.
 * Uses native fetch without external dependencies.
 */
export class GroqAiProvider implements AiProvider {
  public readonly providerName = 'groq';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: GroqAiProviderOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error('GroqAiProvider requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey.trim();
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.baseUrl = options.baseUrl?.trim() || GROQ_CHAT_COMPLETIONS_URL;
  }

  public async generateDraft(options: AiGenerationOptions): Promise<AiGenerationResult> {
    // 1. Check if caller abort signal is already triggered
    if (options.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }

    // 1.5. Bound prompt message length defensively to protect token consumption
    const totalChars = options.promptMessages.reduce((sum, msg) => sum + msg.content.length, 0);
    if (totalChars > 4000) {
      throw new AiMalformedResponseError('Total prompt character length exceeds maximum safety ceiling (4000)');
    }

    // 2. Build structured output JSON Schema payload for review draft
    const requestBody = {
      model: this.model,
      messages: options.promptMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      max_completion_tokens: 500, // Enforce strict 500 completion token ceiling
      temperature: 0.2,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: {
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
      },
    };

    // 3. Execute HTTP request via native fetch
    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
    } catch (err: unknown) {
      // Re-throw AbortError directly if aborted
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Network failure or connection refused
      throw new AiProviderUnavailableError('Failed to connect to Groq API');
    }

    // 4. Handle HTTP error status codes (never leaking authorization token)
    if (!response.ok) {
      if (response.status === 429) {
        const retryHeader = response.headers.get('retry-after');
        const seconds = retryHeader ? parseInt(retryHeader, 10) : 60;
        throw new AiProviderUnavailableError(
          'Groq API rate limit exceeded',
          !isNaN(seconds) ? seconds : 60
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderUnavailableError('Groq authentication failed');
      }
      if (response.status >= 500) {
        throw new AiProviderUnavailableError('Groq upstream service unavailable');
      }
      if (response.status === 400) {
        throw new AiMalformedResponseError(`Groq API request invalid (HTTP 400)`);
      }
      throw new AiProviderUnavailableError(`Groq API returned HTTP error ${response.status}`);
    }

    // 5. Parse response JSON
    let responseJson: any;
    try {
      responseJson = await response.json();
    } catch {
      throw new AiMalformedResponseError('Groq returned invalid HTTP JSON response');
    }

    if (!responseJson || typeof responseJson !== 'object') {
      throw new AiMalformedResponseError('Groq returned non-object response');
    }

    const firstChoice = responseJson.choices?.[0];
    if (!firstChoice || typeof firstChoice !== 'object') {
      throw new AiMalformedResponseError('Groq response missing choices[0]');
    }

    // Check for provider refusal
    if (firstChoice.message?.refusal) {
      return {
        status: 'insufficient_context',
        draft: null,
        model: responseJson.model || this.model,
      };
    }

    const rawContent = firstChoice.message?.content;
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      throw new AiMalformedResponseError('Groq response missing message content');
    }

    // 6. Parse structured JSON content
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch {
      throw new AiMalformedResponseError('Groq message content is not valid JSON', rawContent);
    }

    // 7. Parse token usage if available
    let tokenUsage: AiGenerationResult['tokenUsage'];
    if (responseJson.usage && typeof responseJson.usage === 'object') {
      const u = responseJson.usage;
      if (
        typeof u.prompt_tokens === 'number' &&
        typeof u.completion_tokens === 'number' &&
        typeof u.total_tokens === 'number'
      ) {
        tokenUsage = {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        };
      }
    }

    // 8. Validate and format through standard response_parser
    const result = parseProviderResponse(parsedContent, responseJson.model || this.model);
    if (tokenUsage) {
      result.tokenUsage = tokenUsage;
    }

    return result;
  }
}
