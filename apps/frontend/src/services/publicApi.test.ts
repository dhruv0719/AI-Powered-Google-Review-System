import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publicApi, PublicApiError } from './publicApi.js';

describe('publicApi service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('resolvePublicCampaign', () => {
    it('should resolve campaign successfully', async () => {
      const mockDTO = {
        tenant: { displayName: 'Harsh Custom Car Accessories', brandColor: '#2563EB' },
        location: {
          name: 'Main Showroom',
          address: '123 Ring Road',
          city: 'Surat',
          googleReviewUrl: 'https://g.page/r/test/review',
        },
        services: [{ id: 'srv_1', name: 'Ceramic Coating' }],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDTO,
      } as Response);

      const result = await publicApi.resolvePublicCampaign('q_validCampaignCode1234');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/q_validCampaignCode1234',
        expect.objectContaining({
          credentials: 'include',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
      expect(result).toEqual(mockDTO);
    });

    it('should throw PublicApiError with 404 when campaign is not found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            code: 'CAMPAIGN_NOT_FOUND',
            message: 'QR campaign not found or invalid',
          },
        }),
      } as Response);

      await expect(publicApi.resolvePublicCampaign('q_nonexistent1234567890')).rejects.toThrow(
        PublicApiError
      );

      try {
        await publicApi.resolvePublicCampaign('q_nonexistent1234567890');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe('CAMPAIGN_NOT_FOUND');
        expect(err.message).toBe('QR campaign not found or invalid');
      }
    });

    it('should throw PublicApiError with 429 when rate limited', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.',
          },
        }),
      } as Response);

      try {
        await publicApi.resolvePublicCampaign('q_ratelimited1234567890');
      } catch (err: any) {
        expect(err).toBeInstanceOf(PublicApiError);
        expect(err.statusCode).toBe(429);
        expect(err.code).toBe('RATE_LIMITED');
      }
    });

    it('should encode URL parameters properly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await publicApi.resolvePublicCampaign('code with spaces');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/code%20with%20spaces',
        expect.anything()
      );
    });
  });

  describe('createPublicSession', () => {
    it('should issue POST request with credentials included', async () => {
      const mockResponse = {
        expiresAt: new Date().toISOString(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await publicApi.createPublicSession('q_campaignCode12345678');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/q_campaignCode12345678/sessions',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('submitPublicFeedback', () => {
    it('should issue POST request with feedback payload', async () => {
      const mockResponse = {
        success: true,
        feedbackId: 'fb_12345',
        message: 'Feedback received',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const payload = {
        rating: 5,
        serviceIds: ['srv_1'],
        feedbackText: 'Outstanding service!',
        consentGiven: true as const,
      };

      const result = await publicApi.submitPublicFeedback('q_campaignCode12345678', payload);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/q_campaignCode12345678/feedback',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify(payload),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('generateAiDraft', () => {
    const mockRequestPayload = {
      clientDraftId: 'c1234567-89ab-4cde-8f01-23456789abcd',
      feedback: 'The service was prompt, professional, and very thorough.',
      rating: 5,
      serviceIds: ['s1234567-89ab-4cde-8f01-23456789abcd'],
      language: 'en',
    };

    it('should issue POST request with credentials, JSON headers, and payload', async () => {
      const mockResponse = {
        status: 'generated' as const,
        draft: 'I had an exceptional experience with prompt, professional service.',
        generationsRemaining: 2,
        isReplay: false,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await publicApi.generateAiDraft('q_campaignCode12345678', mockRequestPayload);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/q_campaignCode12345678/generate-draft',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(mockRequestPayload),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should safely encode campaign code with special characters', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'generated',
          draft: 'Polished text',
          generationsRemaining: 2,
          isReplay: false,
        }),
      } as Response);

      await publicApi.generateAiDraft('code with spaces/and?symbols', mockRequestPayload);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/public/qr/code%20with%20spaces%2Fand%3Fsymbols/generate-draft',
        expect.anything()
      );
    });

    it('should return successful generated draft response DTO', async () => {
      const mockResponse = {
        status: 'generated' as const,
        draft: 'Polished draft text here',
        generationsRemaining: 1,
        isReplay: false,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await publicApi.generateAiDraft('q_testCode123', mockRequestPayload);

      expect(result.status).toBe('generated');
      expect(result.draft).toBe('Polished draft text here');
      expect(result.generationsRemaining).toBe(1);
      expect(result.isReplay).toBe(false);
    });

    it('should return successful insufficient_context response DTO with null draft', async () => {
      const mockResponse = {
        status: 'insufficient_context' as const,
        draft: null,
        generationsRemaining: 3,
        isReplay: false,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await publicApi.generateAiDraft('q_testCode123', {
        clientDraftId: 'c1234567-89ab-4cde-8f01-23456789abcd',
        feedback: 'Too short',
        serviceIds: [],
      });

      expect(result.status).toBe('insufficient_context');
      expect(result.draft).toBeNull();
      expect(result.generationsRemaining).toBe(3);
      expect(result.isReplay).toBe(false);
    });

    it('should throw PublicApiError with status and error code on error responses', async () => {
      const errorScenarios = [
        { status: 400, code: 'VALIDATION_ERROR', message: 'Feedback cannot exceed 500 characters' },
        { status: 401, code: 'INVALID_SESSION', message: 'Session has expired' },
        {
          status: 409,
          code: 'IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH',
          message: 'Client draft ID was already submitted with different parameters',
        },
        { status: 429, code: 'QUOTA_EXCEEDED', message: 'Draft generation quota exceeded' },
        {
          status: 502,
          code: 'OUTPUT_GUARDRAIL_FAILED',
          message: 'The generated draft did not meet quality standards',
        },
        {
          status: 504,
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'AI generation service timed out',
        },
      ];

      for (const scenario of errorScenarios) {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: scenario.status,
          json: async () => ({
            error: {
              code: scenario.code,
              message: scenario.message,
            },
          }),
        } as Response);

        try {
          await publicApi.generateAiDraft('q_testCode123', mockRequestPayload);
          expect.fail(`Expected call to throw PublicApiError for ${scenario.code}`);
        } catch (err: any) {
          expect(err).toBeInstanceOf(PublicApiError);
          expect(err.statusCode).toBe(scenario.status);
          expect(err.code).toBe(scenario.code);
          expect(err.message).toBe(scenario.message);
        }
      }
    });

    it('should propagate network failures when fetch rejects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        publicApi.generateAiDraft('q_testCode123', mockRequestPayload)
      ).rejects.toThrow('Failed to fetch');
    });
  });
});
