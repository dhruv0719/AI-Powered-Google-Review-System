import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QRScanLanding } from './QRScanLanding.js';
import { publicApi, PublicApiError, ResolveCampaignOptions } from '../../services/publicApi.js';
import { PublicQRResolutionDTO } from '@review-system/shared';

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
    expect(screen.getByTestId('customer-review-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('private-feedback-card')).not.toBeInTheDocument();
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

  it('5. initial load succeeds when rendered inside React.StrictMode', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(
      (_code: string, options?: ResolveCampaignOptions) => {
        return new Promise<PublicQRResolutionDTO>((resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }

          const timer = setTimeout(() => {
            resolve(mockCampaign);
          }, 15);

          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true }
          );
        });
      }
    );

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/qr/q_strictModeTest']}>
          <Routes>
            <Route path="/qr/:code" element={<QRScanLanding />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });

    expect(screen.queryByText(/Loading customer review page/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
  });

  it('6. first StrictMode request is aborted and second request succeeds', async () => {
    let callCount = 0;
    let firstRequestAborted = false;
    let secondRequestResolved = false;

    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(
      (_code: string, options?: ResolveCampaignOptions) => {
        callCount++;
        const currentCall = callCount;

        return new Promise<PublicQRResolutionDTO>((resolve, reject) => {
          if (options?.signal?.aborted) {
            if (currentCall === 1) firstRequestAborted = true;
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }

          const timer = setTimeout(() => {
            if (currentCall === 2) secondRequestResolved = true;
            resolve(mockCampaign);
          }, 20);

          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              if (currentCall === 1) firstRequestAborted = true;
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true }
          );
        });
      }
    );

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/qr/q_abortCycle']}>
          <Routes>
            <Route path="/qr/:code" element={<QRScanLanding />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });

    expect(callCount).toBe(2);
    expect(firstRequestAborted).toBe(true);
    expect(secondRequestResolved).toBe(true);
  });

  it('7. a stale request cannot overwrite a newer request data', async () => {
    const campaignA: PublicQRResolutionDTO = {
      ...mockCampaign,
      tenant: { displayName: 'Tenant A (Slow)', brandColor: '#111827' },
    };
    const campaignB: PublicQRResolutionDTO = {
      ...mockCampaign,
      tenant: { displayName: 'Tenant B (Fast)', brandColor: '#2563EB' },
    };

    let triggerResolveA: () => void;

    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation((code: string) => {
      if (code === 'q_codeA') {
        return new Promise((resolve) => {
          triggerResolveA = () => resolve(campaignA);
        });
      }
      return Promise.resolve(campaignB);
    });

    function DynamicQRTest({ initialCode }: { initialCode: string }) {
      const [currentCode, setCurrentCode] = React.useState(initialCode);
      return (
        <div>
          <button data-testid="switch-code-btn" onClick={() => setCurrentCode('q_codeB')}>
            Switch
          </button>
          <QRScanLanding code={currentCode} />
        </div>
      );
    }

    render(
      <MemoryRouter>
        <DynamicQRTest initialCode="q_codeA" />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading customer review page/i)).toBeInTheDocument();

    // Switch to q_codeB while q_codeA is still pending
    fireEvent.click(screen.getByTestId('switch-code-btn'));

    // Fast request B resolves first
    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Tenant B (Fast)');
    });

    // Stale request A resolves afterwards
    triggerResolveA!();

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('business-name')).toHaveTextContent('Tenant B (Fast)');
    expect(screen.queryByText('Tenant A (Slow)')).not.toBeInTheDocument();
  });

  it('8. changing the QR code while a request is pending does not leave the page loading', async () => {
    let callCount = 0;
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(
      (_code: string, options?: ResolveCampaignOptions) => {
        callCount++;
        return new Promise<PublicQRResolutionDTO>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              ...mockCampaign,
              tenant: { displayName: `Campaign ${_code}`, brandColor: '#2563EB' },
            });
          }, 30);

          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true }
          );
        });
      }
    );

    function RouteSwitcher() {
      const navigate = useNavigate();
      return (
        <div>
          <button data-testid="nav-code-2" onClick={() => navigate('/qr/q_secondCode')}>
            Nav to 2
          </button>
          <Routes>
            <Route path="/qr/:code" element={<QRScanLanding />} />
          </Routes>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/qr/q_firstCode']}>
        <RouteSwitcher />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading customer review page/i)).toBeInTheDocument();

    // Navigate to q_secondCode while request 1 is pending
    fireEvent.click(screen.getByTestId('nav-code-2'));

    // New request resolves and loading finishes
    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Campaign q_secondCode');
    });

    expect(screen.queryByText(/Loading customer review page/i)).not.toBeInTheDocument();
    expect(callCount).toBe(2);
  });

  it('9. manual retry works after a failed request', async () => {
    let callCount = 0;
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new PublicApiError('Service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE');
      }
      return mockCampaign;
    });

    render(
      <MemoryRouter initialEntries={['/qr/q_retryFailTest']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/This review service is currently unavailable/i)).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(callCount).toBe(2);
  });

  it('10. loading state eventually ends after success or genuine failure', async () => {
    // 10a: Failure terminates loading
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValueOnce(
      new PublicApiError('Internal server error', 500)
    );

    const { unmount } = render(
      <MemoryRouter initialEntries={['/qr/q_failureEndsLoading']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Loading customer review page/i)).not.toBeInTheDocument();

    unmount();

    // 10b: Success terminates loading
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValueOnce(mockCampaign);

    render(
      <MemoryRouter initialEntries={['/qr/q_successEndsLoading']}>
        <Routes>
          <Route path="/qr/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toHaveTextContent('Apex Car Care');
    });
    expect(screen.queryByText(/Loading customer review page/i)).not.toBeInTheDocument();
  });
});
