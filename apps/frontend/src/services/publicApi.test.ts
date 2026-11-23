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
});
