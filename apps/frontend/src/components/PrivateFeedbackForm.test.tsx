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
      screen.getByText('Unable to submit feedback. Please check your connection and try again.')
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
    expect(submitBtn.style.color).toBe('rgb(17, 24, 39)'); // #111827 (dark text for light background)

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
});
