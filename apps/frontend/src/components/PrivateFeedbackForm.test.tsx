import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateFeedbackForm } from './PrivateFeedbackForm.js';
import { publicApi } from '../services/publicApi.js';

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
});
