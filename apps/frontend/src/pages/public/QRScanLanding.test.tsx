import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QRScanLanding } from './QRScanLanding.js';
import { publicApi, PublicApiError } from '../../services/publicApi.js';
import { ErrorCodes } from '@review-system/shared';

describe('QRScanLanding (M4 Customer Landing Page)', () => {
  const mockSuccessDTO = {
    tenant: {
      displayName: 'Harsh Custom Car Accessories',
      brandColor: '#2563EB',
    },
    location: {
      name: 'Adajan Showroom',
      address: 'Shop 4, Prime Arcade, Adajan',
      city: 'Surat',
      googleReviewUrl: 'https://g.page/r/harsh-custom-car/review',
    },
    services: [
      { id: 'srv_1', name: 'Ceramic Coating' },
      { id: 'srv_2', name: 'PPF Installation' },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const renderComponent = (code = 'q_campaignCode12345678') => {
    return render(
      <MemoryRouter initialEntries={[`/q/${code}`]}>
        <Routes>
          <Route path="/q/:code" element={<QRScanLanding />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('1. should display loading state on initial mount', () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(
      () => new Promise(() => {}) // pending forever
    );

    renderComponent();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading customer review page/i)).toBeInTheDocument();
  });

  it('2. should display customer-safe error state when campaign is not found (404)', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Not found', 404, ErrorCodes.CAMPAIGN_NOT_FOUND)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Review Page Unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('This review link is not found or has expired.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });

  it('3. should display customer-safe error state when campaign is inactive (400)', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Inactive', 400, ErrorCodes.CAMPAIGN_INACTIVE)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Review Page Unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('This review campaign is currently inactive.')
    ).toBeInTheDocument();
  });

  it('4. should display customer-safe error state when rate limited (429)', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Rate limited', 429, ErrorCodes.RATE_LIMITED)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Review Page Unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Too many requests. Please try again in a few minutes.')
    ).toBeInTheDocument();
  });

  it('5. should display merchant identity correctly upon successful resolution', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toBeInTheDocument();
    });

    expect(screen.getByTestId('business-name')).toHaveTextContent(
      'Harsh Custom Car Accessories'
    );
    expect(screen.getByTestId('location-name')).toHaveTextContent('Adajan Showroom');
    expect(screen.getByTestId('location-address')).toHaveTextContent(
      'Shop 4, Prime Arcade, Adajan, Surat'
    );
  });

  it('6. should render UNCONDITIONAL Google Review CTA with correct link attributes', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toHaveAttribute(
      'href',
      'https://g.page/r/harsh-custom-car/review'
    );
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    expect(cta).toHaveTextContent(/Write a Review on Google/i);
  });

  it('7. should apply custom valid brandColor to header border and CTA button', async () => {
    const customBrandDTO = {
      ...mockSuccessDTO,
      tenant: {
        ...mockSuccessDTO.tenant,
        brandColor: '#10B981',
      },
    };
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(customBrandDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    const cta = screen.getByTestId('google-review-cta');
    expect(cta.style.backgroundColor).toBe('rgb(16, 185, 129)'); // #10B981 in RGB
  });

  it('8. should safely fall back to #2563EB if brandColor is invalid or malformed', async () => {
    const malformedBrandDTO = {
      ...mockSuccessDTO,
      tenant: {
        ...mockSuccessDTO.tenant,
        brandColor: 'invalid-not-a-hex',
      },
    };
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(malformedBrandDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    const cta = screen.getByTestId('google-review-cta');
    expect(cta.style.backgroundColor).toBe('rgb(37, 99, 235)'); // #2563EB in RGB
  });

  it('9. STRICT M4/M5 BOUNDARY: should NEVER render private feedback form or CTA on M4 landing page', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    // Zero rating stars
    expect(screen.queryByRole('group', { name: /rating/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('star-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('star-5')).not.toBeInTheDocument();

    // Zero feedback forms or textareas
    expect(screen.queryByTestId('private-feedback-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /comments/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    // Zero private feedback submission buttons
    expect(
      screen.queryByRole('button', { name: /submit private feedback/i })
    ).not.toBeInTheDocument();
  });

  it('10. should map SERVICE_UNAVAILABLE (400) to customer-safe message', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Service unavailable', 400, ErrorCodes.SERVICE_UNAVAILABLE)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('This review service is currently unavailable.')
    ).toBeInTheDocument();
  });

  it('11. should map TENANT_SUSPENDED (403) to customer-safe message', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Tenant suspended', 403, ErrorCodes.TENANT_SUSPENDED)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('This review service is currently unavailable.')
    ).toBeInTheDocument();
  });

  it('12. should map unexpected/raw errors to generic safe message without leaking details', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new Error('SELECT * FROM secret_database_table connection refused at 10.0.0.1:5432')
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // MUST NOT leak raw database or connection string
    expect(screen.queryByText(/secret_database_table/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/5432/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('Unable to load review page. Please check your connection and try again.')
    ).toBeInTheDocument();
  });

  it('13. should defensively reject malformed resolution DTO and display safe error state', async () => {
    const malformedDTO = {
      tenant: { displayName: '', brandColor: '#2563EB' }, // empty display name
      location: null,
      services: [],
    } as any;

    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(malformedDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('This review link is invalid, expired, or inactive.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('google-review-cta')).not.toBeInTheDocument();
  });

  it('14. should defensively reject unsafe Google review URL (e.g. javascript:) and never render CTA', async () => {
    const maliciousUrlDTO = {
      ...mockSuccessDTO,
      location: {
        ...mockSuccessDTO.location,
        googleReviewUrl: 'javascript:alert("pwned")',
      },
    };

    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(maliciousUrlDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('google-review-cta')).not.toBeInTheDocument();
    expect(
      screen.getByText('This review link is invalid, expired, or inactive.')
    ).toBeInTheDocument();
  });

  it('15. should support accessible retry action for temporary resolution failures', async () => {
    const resolveSpy = vi
      .spyOn(publicApi, 'resolvePublicCampaign')
      .mockRejectedValueOnce(new PublicApiError('Rate limited', 429, ErrorCodes.RATE_LIMITED))
      .mockResolvedValueOnce(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    expect(screen.getByText('Too many requests. Please try again in a few minutes.')).toBeInTheDocument();

    // Click retry
    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    expect(screen.getByTestId('business-name')).toHaveTextContent('Harsh Custom Car Accessories');
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  it('16. should remain in error state with retry button if retry fails', async () => {
    const resolveSpy = vi
      .spyOn(publicApi, 'resolvePublicCampaign')
      .mockRejectedValue(new PublicApiError('Unavailable', 500));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    // Click retry
    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    expect(
      screen.getByText('This review link is currently unavailable. Please try again later.')
    ).toBeInTheDocument();
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  it('17. should prevent overlapping resolution requests when in-flight', async () => {
    let resolvePromise: (val: any) => void;
    const slowPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const resolveSpy = vi
      .spyOn(publicApi, 'resolvePublicCampaign')
      .mockImplementationOnce(() => slowPromise as any);

    renderComponent();

    // While initial resolution is in-flight, only 1 request must be initiated
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // Resolve the in-flight request
    resolvePromise!(mockSuccessDTO);

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });
  });
});
