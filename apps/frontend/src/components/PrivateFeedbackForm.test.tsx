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
});
