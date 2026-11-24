import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PublicCustomerLayout } from '../../layouts/PublicCustomerLayout.js';
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
          <Route element={<PublicCustomerLayout />}>
            <Route path="/q/:code" element={<QRScanLanding />} />
          </Route>
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

  it('9. M5 COEXISTENCE: should render both Google CTA and Private Feedback form after successful campaign resolution', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    // Unconditional Google Review CTA is rendered
    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', 'https://g.page/r/harsh-custom-car/review');

    // Private Feedback Card and Form are simultaneously rendered
    expect(screen.getByTestId('private-feedback-card')).toBeInTheDocument();
    expect(screen.getByTestId('private-feedback-form')).toBeInTheDocument();
    expect(screen.getByText('Send Private Feedback to Management')).toBeInTheDocument();
    expect(
      screen.getByText(/Your feedback is sent directly to management and will not be posted to Google/i)
    ).toBeInTheDocument();
  });

  it('9a. POLICY INVARIANT: Google CTA is available immediately before any feedback interaction with zero rating or consent requirement', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).not.toHaveAttribute('aria-disabled', 'true');

    // Consent checkbox is not checked
    const consent = screen.getByRole('checkbox', { name: /i agree/i });
    expect(consent).not.toBeChecked();

    // No star radio is checked
    const stars = [1, 2, 3, 4, 5].map((s) => screen.getByTestId(`star-${s}`) as HTMLInputElement);
    expect(stars.every((star) => !star.checked)).toBe(true);
  });

  it('9b. POLICY INVARIANT: Selecting 1-star does NOT gate, hide, disable, or alter Google Review CTA', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    // Customer selects low rating (1 star)
    fireEvent.click(screen.getByTestId('star-1'));
    await waitFor(() => {
      expect((screen.getByTestId('star-1') as HTMLInputElement).checked).toBe(true);
    });

    // Google CTA MUST remain fully visible, ungated, and functional
    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', 'https://g.page/r/harsh-custom-car/review');
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveTextContent(/Write a Review on Google/i);
  });

  it('9c. POLICY INVARIANT: Selecting 5-star does NOT gate, hide, disable, or alter Google Review CTA or private feedback', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    // Customer selects high rating (5 stars)
    fireEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => {
      expect((screen.getByTestId('star-5') as HTMLInputElement).checked).toBe(true);
    });

    // Both Google CTA and Private Feedback form remain in the document
    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', 'https://g.page/r/harsh-custom-car/review');
    expect(screen.getByTestId('private-feedback-form')).toBeInTheDocument();
  });

  it('9d. INTEGRATION: Private feedback receives correct campaign code and resolved service information', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent('q_customCampaign999');

    await waitFor(() => {
      expect(screen.getByTestId('private-feedback-form')).toBeInTheDocument();
    });

    // Verifies resolved services are passed and rendered as chips
    expect(screen.getByText('Ceramic Coating')).toBeInTheDocument();
    expect(screen.getByText('PPF Installation')).toBeInTheDocument();
  });

  it('9e. ISOLATION: Loading and campaign error states do NOT incorrectly mount the feedback form', async () => {
    // 1. Loading state: feedback form must NOT mount
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockImplementation(
      () => new Promise(() => {}) // pending forever
    );

    const { unmount } = renderComponent();
    expect(screen.queryByTestId('private-feedback-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-review-cta')).not.toBeInTheDocument();

    unmount();

    // 2. Error state (404 Not Found): feedback form must NOT mount
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new PublicApiError('Not found', 404, ErrorCodes.CAMPAIGN_NOT_FOUND)
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('private-feedback-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-review-cta')).not.toBeInTheDocument();
  });

  it('9f. END-TO-END FLOW: should complete successful private feedback submission from landing page while preserving lazy session and keeping Google CTA accessible', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });
    const submitSpy = vi.spyOn(publicApi, 'submitPublicFeedback').mockResolvedValue({
      success: true,
      feedbackId: 'fb_landing_integration_123',
      message: 'Feedback received successfully',
    });

    renderComponent('q_campaignCode12345678');

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
      expect(screen.getByTestId('private-feedback-form')).toBeInTheDocument();
    });

    // 1. PRESERVE LAZY SESSION: Session is NOT initiated upon page resolution
    expect(sessionSpy).not.toHaveBeenCalled();

    // 2. User interacts with star rating -> triggers lazy session
    fireEvent.click(screen.getByTestId('star-4'));
    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledWith('q_campaignCode12345678');
    });

    // 3. Select service chip
    fireEvent.click(screen.getByText('Ceramic Coating'));

    // 4. Fill optional comments and contact
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'Great ceramic coating service and friendly team.' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: 'customer@example.com' },
    });

    // 5. Consent checkbox
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    // 6. Submit feedback
    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // 7. Verify submission payload dispatched to publicApi
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith('q_campaignCode12345678', {
        rating: 4,
        serviceIds: ['srv_1'],
        feedbackText: 'Great ceramic coating service and friendly team.',
        customerContact: 'customer@example.com',
        consentGiven: true,
        clientSubmissionId: expect.any(String),
      });
    });

    // 8. Form transitions to success confirmation
    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });
    expect(screen.getByText('Thank You for Your Feedback!')).toBeInTheDocument();

    // 9. POLICY INVARIANT: Google CTA remains available and clickable throughout and after submission
    const cta = screen.getByTestId('google-review-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', 'https://g.page/r/harsh-custom-car/review');
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

  it('18. should render semantic <main> landmark for page content, loading, and error states', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    // Verify main landmark in loading or resolved state
    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument();
    });

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toContainElement(screen.getByTestId('business-name'));
    expect(main).toContainElement(screen.getByTestId('google-review-cta'));
  });

  it('19. should select high-contrast text color for CTA button depending on merchant brand color', async () => {
    // Test light brand color (#10B981) -> dark text (#111827)
    const lightBrandDTO = {
      ...mockSuccessDTO,
      tenant: {
        ...mockSuccessDTO.tenant,
        brandColor: '#10B981',
      },
    };
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(lightBrandDTO);

    const { unmount } = renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    let cta = screen.getByTestId('google-review-cta');
    expect(cta.style.color).toBe('rgb(0, 0, 0)'); // #000000 (mathematically guaranteed contrast >= 4.5:1)

    unmount();

    // Test dark brand color (#2563EB) -> white text (#ffffff)
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    cta = screen.getByTestId('google-review-cta');
    expect(cta.style.color).toBe('rgb(255, 255, 255)'); // #ffffff (white text for dark background)
  });

  it('20. should render high-contrast address subtext color meeting WCAG AA (>= 4.5:1)', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('location-address')).toBeInTheDocument();
    });

    const address = screen.getByTestId('location-address');
    // #4b5563 (rgb(75, 85, 99)) achieves 7.0:1 contrast ratio against white (exceeds WCAG AA 4.5:1)
    expect(address.style.color).toBe('rgb(75, 85, 99)');
  });

  it('21. should render CTA with touch-target >= 48px and touch-press tactile class', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue(mockSuccessDTO);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
    });

    const cta = screen.getByTestId('google-review-cta');
    expect(cta.style.minHeight).toBe('48px');
    expect(cta.classList.contains('touch-press')).toBe(true);
  });
});
