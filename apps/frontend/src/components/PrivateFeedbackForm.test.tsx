import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateFeedbackForm } from './PrivateFeedbackForm.js';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { ErrorCodes } from '@review-system/shared';

describe('PrivateFeedbackForm (Extracted M5 Component)', () => {
  const defaultProps = {
    code: 'q_campaignCode12345678',
    locationName: 'Adajan Showroom',
    googleReviewUrl: 'https://g.page/r/test/review',
    services: [
      { id: 'srv_1', name: 'Ceramic Coating' },
      { id: 'srv_2', name: 'PPF Installation' },
    ],
    brandColor: '#2563EB',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. should render stars, services, inputs, and consent checkbox initially', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    expect(screen.getByTestId('private-feedback-form')).toBeInTheDocument();
    expect(screen.getByTestId('star-1')).toBeInTheDocument();
    expect(screen.getByTestId('star-5')).toBeInTheDocument();
    expect(screen.getByText('Ceramic Coating')).toBeInTheDocument();
    expect(screen.getByText('PPF Installation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/share details/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/contact you back/i)).toBeInTheDocument();

    const consent = screen.getByRole('checkbox', { name: /i agree/i });
    expect(consent).toBeInTheDocument();
    expect(consent).not.toBeChecked(); // MUST NOT be checked by default
  });

  it('2. submit button should remain disabled until star rating AND consent are provided', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    expect(submitBtn).toBeDisabled();

    // Select rating only
    fireEvent.click(screen.getByTestId('star-4'));
    expect(submitBtn).toBeDisabled();

    // Check consent checkbox
    const consent = screen.getByRole('checkbox', { name: /i agree/i });
    fireEvent.click(consent);
    expect(consent).toBeChecked();

    // Now submit should be enabled
    expect(submitBtn).not.toBeDisabled();
  });

  it('3. should trigger lazy session creation on first user interaction', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    render(<PrivateFeedbackForm {...defaultProps} />);

    expect(sessionSpy).not.toHaveBeenCalled();

    // Click star
    fireEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledWith('q_campaignCode12345678');
    });
  });

  it('4. should successfully submit feedback and display thank you confirmation', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi.spyOn(publicApi, 'submitPublicFeedback').mockResolvedValue({
      success: true,
      feedbackId: 'fb_123',
      message: 'Feedback received',
    });

    const onSuccess = vi.fn();
    render(<PrivateFeedbackForm {...defaultProps} onSuccess={onSuccess} />);

    // Fill form
    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'Great car wash and ceramic coating experience!' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: 'customer@example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledWith('q_campaignCode12345678', {
      rating: 5,
      serviceIds: ['srv_1'],
      feedbackText: 'Great car wash and ceramic coating experience!',
      customerContact: 'customer@example.com',
      consentGiven: true,
      clientSubmissionId: expect.any(String),
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(screen.getByText('Thank You for Your Feedback!')).toBeInTheDocument();
    expect(screen.getByText(/Leave a Google Review/i)).toBeInTheDocument();
  });

  it('5. should deduplicate concurrent user interactions to a single session creation request', async () => {
    let resolveSession: (val: any) => void;
    const slowSessionPromise = new Promise((resolve) => {
      resolveSession = resolve;
    });

    const sessionSpy = vi
      .spyOn(publicApi, 'createPublicSession')
      .mockReturnValue(slowSessionPromise as any);

    render(<PrivateFeedbackForm {...defaultProps} />);

    // Trigger multiple user interactions concurrently
    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    // Should only have initiated 1 call
    expect(sessionSpy).toHaveBeenCalledTimes(1);

    // Resolve the session promise
    resolveSession!({ expiresAt: new Date().toISOString() });
    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('6. should display customer-safe error if session creation fails during submit', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockRejectedValue(
      new PublicApiError('Failed to start session', 500)
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Unable to start feedback session. Please try again.')
    ).toBeInTheDocument();
  });

  it('7. should prevent duplicate submissions via synchronous ref lock when user clicks submit repeatedly', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    let resolveSubmit: (val: any) => void;
    const slowSubmitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockReturnValue(slowSubmitPromise as any);

    render(<PrivateFeedbackForm {...defaultProps} />);

    // Click star to initiate session
    fireEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => {
      expect(publicApi.createPublicSession).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });

    // First click initiates submission
    fireEvent.click(submitBtn);

    // Second rapid click while submission is in-flight is rejected by synchronous ref lock
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    resolveSubmit!({ success: true, feedbackId: 'fb_1', message: 'Ok' });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });
  });

  it('8. should handle ALREADY_SUBMITTED (409) failure with customer-safe message', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValue(
      new PublicApiError('Duplicate', 409, ErrorCodes.ALREADY_SUBMITTED)
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Feedback has already been submitted for this session.')
    ).toBeInTheDocument();
  });

  it('9. should handle INVALID_SESSION (401) failure and recover by establishing a fresh session on retry', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new PublicApiError('Expired', 401, ErrorCodes.INVALID_SESSION))
      .mockResolvedValueOnce({ success: true, feedbackId: 'fb_recovered', message: 'Ok' });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Your session has expired. Please select your rating again to refresh.')
    ).toBeInTheDocument();

    // Verify recovery: user clicks star again, which triggers a new fresh session
    fireEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(2); // fresh session call!
    });

    // User submits again
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('10. should handle unexpected submission failure without leaking raw error messages', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValue(
      new Error('fatal: pg_query failed: foreign key violation in private_feedback_services table')
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Verify raw error text is NOT leaked
    expect(screen.queryByText(/pg_query/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/foreign key/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/We could not confirm if your feedback reached management/i)
    ).toBeInTheDocument();
  });

  it('11. should render accessible native radio stars inside fieldset with legend and 48x48px touch targets', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    // Fieldset and Legend
    expect(screen.getByRole('group', { name: /How was your overall experience/i })).toBeInTheDocument();

    // 5 radio inputs
    for (let star = 1; star <= 5; star++) {
      const radio = screen.getByRole('radio', { name: `${star} star${star > 1 ? 's' : ''}` });
      expect(radio).toBeInTheDocument();
      expect(radio).not.toBeChecked();

      const label = screen.getByTestId(`star-label-${star}`);
      expect(label.style.width).toBe('48px');
      expect(label.style.height).toBe('48px');
      expect(label.classList.contains('touch-press')).toBe(true);
      expect(label.classList.contains('star-radio-item')).toBe(true);
    }
  });

  it('12. should prevent iOS Safari auto-zoom with 16px font size on inputs and textareas', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/share details/i);
    expect(textarea.style.fontSize).toBe('16px');

    const contactInput = screen.getByPlaceholderText(/contact you back/i);
    expect(contactInput.style.fontSize).toBe('16px');
    expect(contactInput.style.minHeight).toBe('44px');
  });

  it('13. should link character counter via aria-describedby and announce via aria-live="polite"', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/share details/i);
    expect(textarea).toHaveAttribute('aria-describedby', 'feedback-text-counter');

    const counter = document.getElementById('feedback-text-counter');
    expect(counter).toBeInTheDocument();
    expect(counter).toHaveAttribute('aria-live', 'polite');
    expect(counter).toHaveTextContent('0/1000 characters');

    // Type 10 characters
    fireEvent.change(textarea, { target: { value: '0123456789' } });
    expect(counter).toHaveTextContent('10/1000 characters');
  });

  it('14. should toggle aria-pressed and active styles on service chips with minHeight >= 40px', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    const ceramicChip = screen.getByRole('button', { name: 'Ceramic Coating' });
    expect(ceramicChip).toHaveAttribute('aria-pressed', 'false');
    expect(ceramicChip.style.minHeight).toBe('40px');
    expect(ceramicChip.classList.contains('touch-press')).toBe(true);

    // Toggle on
    fireEvent.click(ceramicChip);
    expect(ceramicChip).toHaveAttribute('aria-pressed', 'true');

    // Toggle off
    fireEvent.click(ceramicChip);
    expect(ceramicChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('15. should render consent container with touch-friendly padding, 48px touch target, and focus-ring styling', () => {
    render(<PrivateFeedbackForm {...defaultProps} />);

    const consentContainer = document.querySelector('.consent-container');
    expect(consentContainer).toBeInTheDocument();
    expect(consentContainer?.classList.contains('touch-press')).toBe(true);

    const checkbox = screen.getByRole('checkbox', { name: /i agree/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.style.width).toBe('18px');
    expect(checkbox.style.height).toBe('18px');
  });

  it('16. should compute high-contrast submit button text color based on merchant brand color', () => {
    // Light brand color (#10B981) -> dark text (#111827) when enabled
    const { unmount } = render(<PrivateFeedbackForm {...defaultProps} brandColor="#10B981" />);

    // Initially disabled with muted gray background and white text
    const disabledBtn = screen.getByRole('button', { name: /submit private feedback/i });
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn.style.color).toBe('rgb(255, 255, 255)');

    // Enable button by providing rating and consent
    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn.style.backgroundColor).toBe('rgb(16, 185, 129)'); // #10B981
    expect(submitBtn.style.color).toBe('rgb(0, 0, 0)'); // #000000 (guaranteed contrast >= 4.5:1)

    unmount();

    // Dark brand color (#2563EB) -> white text (#ffffff) when enabled
    render(<PrivateFeedbackForm {...defaultProps} brandColor="#2563EB" />);
    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtnDark = screen.getByRole('button', { name: /submit private feedback/i });
    expect(submitBtnDark).not.toBeDisabled();
    expect(submitBtnDark.style.backgroundColor).toBe('rgb(37, 99, 235)'); // #2563EB
    expect(submitBtnDark.style.color).toBe('rgb(255, 255, 255)'); // #ffffff (white text for dark background)
  });

  it('17. should recover from INVALID_SESSION when user re-clicks the already-selected star label directly', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new PublicApiError('Expired', 401, ErrorCodes.INVALID_SESSION))
      .mockResolvedValueOnce({ success: true, feedbackId: 'fb_recovered_label', message: 'Ok' });

    render(<PrivateFeedbackForm {...defaultProps} />);

    // Select star 5 via label
    fireEvent.click(screen.getByTestId('star-label-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Your session has expired. Please select your rating again to refresh.')
    ).toBeInTheDocument();

    // Re-click the visible star label for star 5 (already checked)
    fireEvent.click(screen.getByTestId('star-label-5'));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(2); // fresh session established!
    });

    // Re-submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('18. should recover from INVALID_SESSION when user changes to a different star rating', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new PublicApiError('Expired', 401, ErrorCodes.INVALID_SESSION))
      .mockResolvedValueOnce({ success: true, feedbackId: 'fb_recovered_diff_star', message: 'Ok' });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Switch to star 4
    fireEvent.click(screen.getByTestId('star-4'));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(2);
    });

    // Re-submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('19. should handle INVALID_SERVICES by refreshing available services and pruning stale selections without losing entered data', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    // submit fails initially with INVALID_SERVICES (e.g. srv_2 deactivated on backend)
    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(
        new PublicApiError('Invalid services selected', 400, ErrorCodes.INVALID_SERVICES)
      )
      .mockResolvedValueOnce({
        success: true,
        feedbackId: 'fb_refreshed_ok',
        message: 'Feedback received',
      });

    // Mock resolvePublicCampaign returning only srv_1
    const resolveSpy = vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue({
      tenant: {
        displayName: 'Harsh Custom Car',
        brandColor: '#2563EB',
      },
      location: {
        name: 'Adajan Showroom',
        address: '123 Main St',
        city: 'Surat',
        googleReviewUrl: 'https://g.page/r/test/review',
      },
      services: [{ id: 'srv_1', name: 'Ceramic Coating' }],
    });

    render(<PrivateFeedbackForm {...defaultProps} />);

    // Customer selects rating 5, both services srv_1 and srv_2
    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.click(screen.getByText('PPF Installation'));

    // Customer types comments and contact
    const textarea = screen.getByPlaceholderText(/share details/i);
    const contactInput = screen.getByPlaceholderText(/contact you back/i);
    fireEvent.change(textarea, { target: { value: 'Great ceramic coating work.' } });
    fireEvent.change(contactInput, { target: { value: 'customer@example.com' } });

    // Customer checks consent
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    // Should call resolvePublicCampaign to refresh services
    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith('q_campaignCode12345678');
    });

    // Should display customer-safe message
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'One or more selected services are no longer available. Available services have been refreshed; please review your selection and submit again.'
      )
    ).toBeInTheDocument();

    // Verify stale service 'PPF Installation' (srv_2) is removed from available options
    expect(screen.queryByText('PPF Installation')).not.toBeInTheDocument();

    // Verify 'Ceramic Coating' (srv_1) remains available and still selected
    const ceramicChip = screen.getByRole('button', { name: 'Ceramic Coating' });
    expect(ceramicChip).toBeInTheDocument();
    expect(ceramicChip).toHaveAttribute('aria-pressed', 'true');

    // Verify entered inputs are preserved intact
    expect(textarea).toHaveValue('Great ceramic coating work.');
    expect(contactInput).toHaveValue('customer@example.com');
    expect(screen.getByRole('radio', { name: '5 stars' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /i agree/i })).toBeChecked();

    // Customer submits again
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    // Second submit sent only active service 'srv_1'
    expect(submitSpy).toHaveBeenLastCalledWith('q_campaignCode12345678', {
      rating: 5,
      serviceIds: ['srv_1'],
      feedbackText: 'Great ceramic coating work.',
      customerContact: 'customer@example.com',
      consentGiven: true,
      clientSubmissionId: expect.any(String),
    });
  });

  it('20. should gracefully handle INVALID_SERVICES even if campaign refresh fails without entering retry loop', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValue(
      new PublicApiError('Invalid services selected', 400, ErrorCodes.INVALID_SERVICES)
    );

    // Refresh itself fails (e.g. network timeout)
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockRejectedValue(
      new Error('Failed to resolve campaign')
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Safe error message rendered, form remains usable without crashing
    expect(
      screen.getByText(
        'One or more selected services are no longer available. Available services have been refreshed; please review your selection and submit again.'
      )
    ).toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();
  });

  it('21. should normalize whitespace-only comments and contact to undefined, and trim non-empty values', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi.spyOn(publicApi, 'submitPublicFeedback').mockResolvedValue({
      success: true,
      feedbackId: 'fb_norm_1',
      message: 'Ok',
    });

    const { unmount } = render(<PrivateFeedbackForm {...defaultProps} />);

    // Scenario A: Whitespace-only fields
    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: '     ' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: '   \t  \n  ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    expect(submitSpy).toHaveBeenLastCalledWith('q_campaignCode12345678', {
      rating: 4,
      serviceIds: [],
      feedbackText: undefined,
      customerContact: undefined,
      consentGiven: true,
      clientSubmissionId: expect.any(String),
    });

    unmount();

    // Scenario B: Values with leading and trailing whitespace
    const submitSpy2 = vi.spyOn(publicApi, 'submitPublicFeedback').mockResolvedValue({
      success: true,
      feedbackId: 'fb_norm_2',
      message: 'Ok',
    });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: '  Excellent ceramic coating service!  ' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: '  customer@example.com  ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(submitSpy2).toHaveBeenCalledTimes(1);
    });

    expect(submitSpy2).toHaveBeenLastCalledWith('q_campaignCode12345678', {
      rating: 5,
      serviceIds: [],
      feedbackText: 'Excellent ceramic coating service!',
      customerContact: 'customer@example.com',
      consentGiven: true,
      clientSubmissionId: expect.any(String),
    });
  });

  it('22. should validate minimum feedback comment length (3 characters after trimming) and prevent submit', async () => {
    const submitSpy = vi.spyOn(publicApi, 'submitPublicFeedback');

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    // Enter 2 characters after trimming
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: '  ab  ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    // Form-level error alert is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Feedback comments must be at least 3 characters if provided.')
    ).toBeInTheDocument();

    // Submission API call must NOT be triggered
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('23. should preserve immutable submission snapshot and exact clientSubmissionId across network retry', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    // First attempt fails with network error; second attempt succeeds
    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new Error('Network connection failed'))
      .mockResolvedValueOnce({
        success: true,
        feedbackId: 'fb_idempotent_1',
        message: 'Feedback received',
      });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'Consistent great detailing work.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });

    // Attempt 1: fails
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/We could not confirm if your feedback reached management/i)
    ).toBeInTheDocument();
    expect(submitSpy).toHaveBeenCalledTimes(1);

    const firstSubmissionId = submitSpy.mock.calls[0][1].clientSubmissionId;
    expect(firstSubmissionId).toBeDefined();
    expect(typeof firstSubmissionId).toBe('string');
    expect(firstSubmissionId!.length).toBeGreaterThanOrEqual(16);

    // Attempt 2: retry after network restoration
    fireEvent.click(screen.getByRole('button', { name: /retry submission/i }));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledTimes(2);

    const secondSubmissionId = submitSpy.mock.calls[1][1].clientSubmissionId;
    // CRITICAL IDEMPOTENCY INVARIANT: The retry must preserve the exact same clientSubmissionId
    expect(secondSubmissionId).toBe(firstSubmissionId);
  });

  it('24. should manage form aria-busy state and polite screen reader announcements during submission', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    let resolveSubmit: (val: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockReturnValue(pendingPromise as any);

    render(<PrivateFeedbackForm {...defaultProps} />);

    const form = screen.getByTestId('private-feedback-form');
    // Initially not busy
    expect(form).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    // During in-flight submission: aria-busy is true, button is busy, polite announcement is active
    await waitFor(() => {
      expect(form).toHaveAttribute('aria-busy', 'true');
    });

    expect(
      screen.getByText('Submitting your private feedback to management...')
    ).toBeInTheDocument();
    expect(submitBtn).toHaveTextContent('Submitting Feedback...');
    expect(submitBtn).toBeDisabled();

    // Complete submission
    resolveSubmit!({ success: true, feedbackId: 'fb_busy_done', message: 'Ok' });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });
  });

  it('25. should disable all form controls while an ambiguous network submission is pending and display honest message', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValueOnce(
      new Error('TypeError: Failed to fetch')
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'Detailed review notes' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: 'user@test.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    const submitBtn = screen.getByRole('button', { name: /submit private feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Honest customer-facing message explaining submission may have reached management
    expect(
      screen.getByText(/We could not confirm if your feedback reached management/i)
    ).toBeInTheDocument();

    // All form controls must be disabled while outcome is unresolved
    expect(screen.getByTestId('star-5')).toBeDisabled();
    expect(screen.getByTestId('star-1')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ceramic Coating/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/share details/i)).toBeDisabled();
    expect(screen.getByPlaceholderText(/contact you back/i)).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /i agree/i })).toBeDisabled();

    // Submit button changes to Retry Submission and is ENABLED for retry
    const retryBtn = screen.getByRole('button', { name: /retry submission/i });
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();
  });

  it('26. should prevent editing form inputs while an uncertain submission outcome is pending', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValueOnce(
      new Error('Network timeout')
    );

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    const textarea = screen.getByPlaceholderText(/share details/i);
    fireEvent.change(textarea, { target: { value: 'Original locked text' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry submission/i })).toBeInTheDocument();
    });

    // Attempting to edit textarea while locked must not change state
    fireEvent.change(textarea, { target: { value: 'Tampered text attempt' } });
    expect(textarea).toHaveValue('Original locked text');

    // Attempting to change rating star while locked must not change selected star
    fireEvent.click(screen.getByTestId('star-1'));
    expect(screen.getByTestId('star-5')).toBeChecked();
    expect(screen.getByTestId('star-1')).not.toBeChecked();
  });

  it('27. should preserve complete original payload including service IDs and consent on retry', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new Error('Connection reset'))
      .mockResolvedValueOnce({ success: true, feedbackId: 'fb_preserved_complete', message: 'Ok' });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.click(screen.getByText('PPF Installation'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'PPF front bumper and hood application.' },
    });
    fireEvent.change(screen.getByPlaceholderText(/contact you back/i), {
      target: { value: 'customer@auto.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    // Submit attempt 1
    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry submission/i })).toBeInTheDocument();
    });

    // Tap Retry Submission
    fireEvent.click(screen.getByRole('button', { name: /retry submission/i }));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    // Both calls must contain the exact same serviceIds, rating, comments, contact, consent, and ID
    expect(submitSpy).toHaveBeenCalledTimes(2);
    const call1 = submitSpy.mock.calls[0][1];
    const call2 = submitSpy.mock.calls[1][1];

    expect(call2.rating).toBe(call1.rating);
    expect(call2.serviceIds).toEqual(call1.serviceIds);
    expect(call2.feedbackText).toBe(call1.feedbackText);
    expect(call2.customerContact).toBe(call1.customerContact);
    expect(call2.consentGiven).toBe(call1.consentGiven);
    expect(call2.clientSubmissionId).toBe(call1.clientSubmissionId);
  });

  it('28. should handle INVALID_SESSION by creating a new session without losing the pending snapshot', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    const submitSpy = vi
      .spyOn(publicApi, 'submitPublicFeedback')
      .mockRejectedValueOnce(new PublicApiError('Session expired', 401, ErrorCodes.INVALID_SESSION))
      .mockResolvedValueOnce({ success: true, feedbackId: 'fb_session_recovered', message: 'Ok' });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.change(screen.getByPlaceholderText(/share details/i), {
      target: { value: 'High gloss ceramic finish' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));

    // Attempt 1 fails with 401
    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Your session has expired/i)).toBeInTheDocument();

    // Re-clicking submit triggers fresh session creation and submits preserved snapshot
    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    // Two session creations occurred
    expect(sessionSpy).toHaveBeenCalledTimes(2);

    // Exact same clientSubmissionId and payload preserved across session recovery
    expect(submitSpy).toHaveBeenCalledTimes(2);
    expect(submitSpy.mock.calls[1][1].clientSubmissionId).toBe(
      submitSpy.mock.calls[0][1].clientSubmissionId
    );
    expect(submitSpy.mock.calls[1][1].serviceIds).toEqual(['srv_1']);
  });

  it('29. should transition to confirmed state upon successful idempotent replay and keep Google Review CTA accessible', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    // Backend returns 200 idempotent replay
    vi.spyOn(publicApi, 'submitPublicFeedback').mockResolvedValue({
      success: true,
      feedbackId: 'fb_replay_id_999',
      message: 'Thank you for your feedback!',
    });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toBeInTheDocument();
    });

    // Confirmation screen rendered
    expect(screen.getByText('Thank You for Your Feedback!')).toBeInTheDocument();

    // Google review link remains accessible and correctly configured
    const googleLink = screen.getByRole('link', { name: /leave a google review/i });
    expect(googleLink).toBeInTheDocument();
    expect(googleLink).toHaveAttribute('href', defaultProps.googleReviewUrl);
    expect(googleLink).toHaveAttribute('target', '_blank');
    expect(googleLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('30. should unlock form controls after a definite rejection so the customer is not permanently locked', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    // Definite 400 rejection (INVALID_SERVICES)
    vi.spyOn(publicApi, 'submitPublicFeedback').mockRejectedValueOnce(
      new PublicApiError('Invalid service', 400, ErrorCodes.INVALID_SERVICES)
    );

    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue({
      tenant: { displayName: 'Harsh Custom Car', brandColor: '#2563EB' },
      location: { name: 'Adajan Showroom', address: '123 Main', city: 'Surat', googleReviewUrl: 'https://g.page/r/test/review' },
      services: [{ id: 'srv_1', name: 'Ceramic Coating' }],
    });

    render(<PrivateFeedbackForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit private feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Inputs must NOT be permanently locked
    const textarea = screen.getByPlaceholderText(/share details/i);
    expect(textarea).not.toBeDisabled();
    expect(screen.getByTestId('star-5')).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /i agree/i })).not.toBeDisabled();

    // Customer can edit comments and submit normally
    fireEvent.change(textarea, { target: { value: 'Updated feedback after service refresh' } });
    expect(textarea).toHaveValue('Updated feedback after service refresh');
  });
});
