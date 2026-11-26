import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QRScanLanding } from './QRScanLanding.js';
import { publicApi, PublicApiError } from '../../services/publicApi.js';

describe('QRScanLanding cold-start and resilience tests', () => {
  const mockCampaign = {
    tenant: { displayName: 'Apex Car Care', brandColor: '#2563EB' },
    location: {
      name: 'Central Workshop',
      address: '77 Motor Way',
      city: 'Surat',
      googleReviewUrl: 'https://g.page/r/apexcar/review',
    },
    services: [{ id: 'srv_1', name: 'Wheel Alignment' }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. should resolve successfully and render unconditional Google Review CTA', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockCampaign);

    render(
      <MemoryRouter initialEntries={['/qr/q_test123']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });

    const googleCta = screen.getByTestId('google-review-cta');
    expect(googleCta).toBeInTheDocument();
    expect(googleCta).toHaveAttribute('href', 'https://g.page/r/apexcar/review');
    expect(googleCta).toHaveTextContent(/Write a Review on Google/i);
    expect(screen.getByTestId('private-feedback-card')).toBeInTheDocument();
  });

  it('2. should display waking up status when cold-start progress is reported', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(async (_code, options) => {
      if (options?.onProgress) {
        options.onProgress({
          attempt: 2,
          maxAttempts: 6,
          delayMs: 4000,
          isColdStart: true,
        });
      }
      // Hold unresolved to observe UI state
      return new Promise(() => {});
    });

    render(
      <MemoryRouter initialEntries={['/qr/q_coldStart']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cold-start-progress')).toBeInTheDocument();
    });

    expect(screen.getByText(/Connecting to Review Portal/i)).toBeInTheDocument();
    expect(screen.getByText(/Waking up server/i)).toBeInTheDocument();
    expect(screen.getByText(/Attempt 2 of 6/i)).toBeInTheDocument();
    expect(screen.getByTestId('cold-start-retry-now')).toBeInTheDocument();
  });

  it('3. manual retry on warming screen re-triggers campaign resolution', async () => {
    let callCount = 0;
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(async (_code, options) => {
      callCount++;
      if (callCount === 1) {
        if (options?.onProgress) {
          options.onProgress({
            attempt: 2,
            maxAttempts: 6,
            delayMs: 4000,
            isColdStart: true,
          });
        }
        return new Promise(() => {});
      }
      return mockCampaign;
    });

    render(
      <MemoryRouter initialEntries={['/qr/q_manualRetry']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cold-start-retry-now')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('cold-start-retry-now'));

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });

    expect(callCount).toBe(2);
  });

  it('4. should render customer-safe error without cold-start UI on 404 CAMPAIGN_NOT_FOUND', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Invalid or expired QR code', 404, 'CAMPAIGN_NOT_FOUND')
    );

    render(
      <MemoryRouter initialEntries={['/qr/q_notFound']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('cold-start-progress')).not.toBeInTheDocument();
    expect(screen.getByText(/This review link is not found or has expired/i)).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });
});
