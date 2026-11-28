/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CustomerReviewFlow } from './CustomerReviewFlow.js';
import { PrivateFeedbackForm } from './PrivateFeedbackForm.js';
import { publicApi } from '../services/publicApi.js';

describe('CustomerReviewFlow Component (Unified Review Journey)', () => {
  const defaultProps = {
    code: 'q_campaignCode12345678',
    tenant: {
      displayName: 'Apex Car Care',
      brandColor: '#006764',
    },
    location: {
      name: 'Adajan Showroom',
      address: '123 Ring Road',
      city: 'Surat',
      googleReviewUrl: 'https://g.page/r/test/review',
    },
    services: [
      { id: 'srv_1', name: 'Ceramic Coating' },
      { id: 'srv_2', name: 'PPF Installation' },
    ],
    brandColor: '#006764',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. should render heading, emoji ratings, services, comments textarea, and unconditional Google Review CTA initially', () => {
    render(<CustomerReviewFlow {...defaultProps} />);

    // Section B: Heading & Subtitle
    expect(screen.getByTestId('share-experience-heading')).toHaveTextContent('Share your experience');
    expect(screen.getByText('Tell us about your experience.')).toBeInTheDocument();

    // Section C: 5 Emoji Ratings
    expect(screen.getByTestId('star-1')).toBeInTheDocument();
    expect(screen.getByTestId('star-5')).toBeInTheDocument();
    expect(screen.getByText('😡')).toBeInTheDocument();
    expect(screen.getByText('🙁')).toBeInTheDocument();
    expect(screen.getByText('😑')).toBeInTheDocument();
    expect(screen.getByText('😊')).toBeInTheDocument();
    expect(screen.getByText('🤩')).toBeInTheDocument();
    expect(screen.getByText('Very bad')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();

    // Section D: Services list (Compulsory)
    expect(screen.getByText(/Which services did you use\?/i)).toBeInTheDocument();
    expect(screen.getByText('Ceramic Coating')).toBeInTheDocument();
    expect(screen.getByText('PPF Installation')).toBeInTheDocument();

    // Section E: Customer comments & character counter
    expect(screen.getByPlaceholderText(/Tell us about your experience/i)).toBeInTheDocument();
    expect(screen.getByTestId('feedback-text-counter')).toHaveTextContent('0/1000 characters');

    // Section H: Unconditional Google Review CTA
    const googleCta = screen.getByTestId('google-review-cta');
    expect(googleCta).toBeInTheDocument();
    expect(googleCta).toHaveAttribute('href', 'https://g.page/r/test/review');
    expect(googleCta).toHaveTextContent(/Write a Review on Google/i);
  });

  it('2. should NOT render any old private feedback submission UI or promotional Google card', () => {
    render(<CustomerReviewFlow {...defaultProps} />);

    // Explicitly verify removal of obsolete private feedback form elements
    expect(screen.queryByTestId('private-feedback-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('private-feedback-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /i agree/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/contact you back/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit private feedback/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-success')).not.toBeInTheDocument();
    expect(screen.queryByText(/Support Us on Google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Public Google reviews directly support our staff/i)).not.toBeInTheDocument();
  });

  it('3. should initiate lazy session creation on first user interaction (rating click)', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    expect(sessionSpy).not.toHaveBeenCalled();

    // Click emoji rating 5
    fireEvent.click(screen.getByTestId('star-5'));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledWith('q_campaignCode12345678');
    });
  });

  it('4. should initiate lazy session creation on service pill toggle or typing in comments', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    expect(sessionSpy).not.toHaveBeenCalled();

    // Toggle service pill
    fireEvent.click(screen.getByText('Ceramic Coating'));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledWith('q_campaignCode12345678');
    });
  });

  it('5. should deduplicate concurrent user interactions to a single session creation request', async () => {
    let resolveSession: (val: any) => void;
    const slowSessionPromise = new Promise((resolve) => {
      resolveSession = resolve;
    });

    const sessionSpy = vi
      .spyOn(publicApi, 'createPublicSession')
      .mockReturnValue(slowSessionPromise as any);

    render(<CustomerReviewFlow {...defaultProps} />);

    // Trigger multiple user interactions concurrently
    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.change(screen.getByPlaceholderText(/Tell us about your experience/i), {
      target: { value: 'Great experience' },
    });

    // Should only have initiated 1 session call
    expect(sessionSpy).toHaveBeenCalledTimes(1);

    resolveSession!({ expiresAt: new Date().toISOString() });
    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('6. should avoid keystroke spam when session creation fails', async () => {
    const sessionSpy = vi
      .spyOn(publicApi, 'createPublicSession')
      .mockRejectedValue(new Error('Network error'));

    render(<CustomerReviewFlow {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/Tell us about your experience/i);
    fireEvent.change(textarea, { target: { value: 'H' } });
    fireEvent.change(textarea, { target: { value: 'He' } });
    fireEvent.change(textarea, { target: { value: 'Hel' } });
    fireEvent.change(textarea, { target: { value: 'Hell' } });
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    // Keystroke typing should not spam session creation
    expect(sessionSpy).toHaveBeenCalledTimes(1);
  });

  it('7. should enforce compulsory service selection before AI polishing can proceed', async () => {
    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft');
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    // Select rating
    fireEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => {
      expect(publicApi.createPublicSession).toHaveBeenCalledWith('q_campaignCode12345678');
    });

    // Provide 20 characters comment without selecting any services
    fireEvent.change(screen.getByPlaceholderText(/Tell us about your experience/i), {
      target: { value: 'Outstanding service and friendly staff!' },
    });

    // Try to click Polish with AI
    const polishBtn = screen.getByRole('button', { name: /polish with ai/i });
    expect(polishBtn).not.toBeDisabled();
    fireEvent.click(polishBtn);

    // Validation error must appear and AI generation must NOT be called
    expect(screen.getByTestId('ai-service-validation-error')).toHaveTextContent(
      'Please select at least one service before polishing with AI.'
    );
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it('8. should allow AI polish when a service is selected and clear validation error', async () => {
    vi.spyOn(publicApi, 'createPublicSession').mockResolvedValue({
      expiresAt: new Date().toISOString(),
    });
    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'The ceramic coating service was performed with exceptional precision.',
      generationsRemaining: 2,
      isReplay: false,
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.change(screen.getByPlaceholderText(/Tell us about your experience/i), {
      target: { value: 'Outstanding service and friendly staff!' },
    });

    // Select service
    fireEvent.click(screen.getByText('Ceramic Coating'));

    // Service validation error should be absent
    expect(screen.queryByTestId('ai-service-validation-error')).not.toBeInTheDocument();

    // Polish with AI
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(aiSpy).toHaveBeenCalledWith(
        'q_campaignCode12345678',
        expect.objectContaining({
          feedback: 'Outstanding service and friendly staff!',
          rating: 5,
          serviceIds: ['srv_1'],
        })
      );
    });

    // Draft card should appear
    expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    expect(screen.getByTestId('ai-regenerate-button')).toBeInTheDocument();
    expect(screen.getByTestId('post-to-google-button')).toBeInTheDocument();

    // Unconditional standalone Google CTA is hidden when an active draft is ready to post
    expect(screen.queryByTestId('google-review-cta')).not.toBeInTheDocument();
  });

  it('9. should support backward compatibility when imported as PrivateFeedbackForm', () => {
    render(
      <PrivateFeedbackForm
        code={defaultProps.code}
        locationName={defaultProps.location.name}
        googleReviewUrl={defaultProps.location.googleReviewUrl}
        services={defaultProps.services}
        brandColor={defaultProps.brandColor}
      />
    );

    expect(screen.getByTestId('share-experience-heading')).toBeInTheDocument();
    expect(screen.getByTestId('google-review-cta')).toHaveAttribute(
      'href',
      'https://g.page/r/test/review'
    );
  });

  // =========================================================================
  // Surviving Behaviors Restored from Original Test Suite
  // =========================================================================
  it('10. should prevent iOS Safari auto-zoom with 16px font size on textareas', () => {
    render(<CustomerReviewFlow {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/Tell us about your experience/i);
    // iOS Safari auto-zooms text inputs with font-size < 16px
    expect(textarea).toHaveStyle({ fontSize: '16px' });
  });

  it('11. should link character counter via aria-describedby and announce via aria-live="polite"', () => {
    render(<CustomerReviewFlow {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/Tell us about your experience/i);
    const counter = screen.getByTestId('feedback-text-counter');

    expect(textarea).toHaveAttribute('aria-describedby', 'feedback-text-counter');
    expect(counter).toHaveAttribute('aria-live', 'polite');
    expect(counter).toHaveTextContent('0/1000 characters');

    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    expect(counter).toHaveTextContent('11/1000 characters');
  });

  it('12. should toggle aria-pressed and active styles on service chips with touch-friendly minHeight >= 40px', () => {
    render(<CustomerReviewFlow {...defaultProps} />);

    const chip = screen.getByRole('button', { name: /Ceramic Coating/i });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).toHaveStyle({ minHeight: '44px' });

    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('13. should await pending session creation when customer enters comments and clicks Polish', async () => {
    let resolveSession: (value: any) => void;
    const pendingSessionPromise = new Promise((resolve) => {
      resolveSession = resolve;
    });
    const sessionSpy = vi
      .spyOn(publicApi, 'createPublicSession')
      .mockReturnValue(pendingSessionPromise as any);
    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      draft: 'Draft generated after pending session completes.',
      generationsRemaining: 2,
      status: 'generated',
      isReplay: false,
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    // Select rating
    fireEvent.click(screen.getByTestId('star-5'));
    // Select service
    fireEvent.click(screen.getByText('Ceramic Coating'));
    // Type feedback
    const textarea = screen.getByPlaceholderText(/Tell us about your experience/i);
    fireEvent.change(textarea, { target: { value: 'Customer input of sufficient length' } });

    // Click Polish while session is pending
    const polishBtn = screen.getByRole('button', { name: /polish with ai/i });
    fireEvent.click(polishBtn);

    expect(sessionSpy).toHaveBeenCalledTimes(1);
    expect(aiSpy).not.toHaveBeenCalled();

    // Resolve the pending session
    resolveSession!({ expiresAt: new Date().toISOString() });

    await waitFor(() => {
      expect(aiSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('14. should allow intentional recovery when session creation fails once, then customer retries AI Polish', async () => {
    const sessionSpy = vi
      .spyOn(publicApi, 'createPublicSession')
      .mockRejectedValueOnce(new Error('Transient network drop'))
      .mockResolvedValueOnce({ expiresAt: new Date().toISOString() });

    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      draft: 'Draft after recovered session.',
      generationsRemaining: 2,
      status: 'generated',
      isReplay: false,
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    fireEvent.change(screen.getByPlaceholderText(/Tell us about your experience/i), {
      target: { value: 'Great detailing and friendly staff!' },
    });

    const polishBtn = screen.getByRole('button', { name: /polish with ai/i });
    fireEvent.click(polishBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        'Unable to start a review session. Please check your connection and try again.'
      );
    });
    expect(aiSpy).not.toHaveBeenCalled();

    // Customer clicks retry on the AI assistant
    const retryBtn = screen.getByTestId('ai-retry-button');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    expect(sessionSpy).toHaveBeenCalledTimes(2);
    expect(aiSpy).toHaveBeenCalledTimes(1);
  });

  it('15. should preserve entered comments, rating, and selected services across session recovery', async () => {
    vi.spyOn(publicApi, 'createPublicSession')
      .mockRejectedValueOnce(new Error('Session service offline'))
      .mockResolvedValueOnce({ expiresAt: new Date().toISOString() });

    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      draft: 'Recovered draft preserves all inputs.',
      generationsRemaining: 2,
      status: 'generated',
      isReplay: false,
    });

    render(<CustomerReviewFlow {...defaultProps} />);

    // Customer selects emoji rating 5, service, and enters text
    fireEvent.click(screen.getByTestId('star-5'));
    fireEvent.click(screen.getByText('Ceramic Coating'));
    const textarea = screen.getByPlaceholderText(/Tell us about your experience/i);
    fireEvent.change(textarea, { target: { value: 'Preserve my entered details across error!' } });

    // Click Polish -> fails at session creation
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toBeInTheDocument();
    });

    // Inputs must remain completely intact!
    expect(textarea).toHaveValue('Preserve my entered details across error!');
    expect(screen.getByTestId('star-5')).toBeChecked();
    expect(screen.getByRole('button', { name: /Ceramic Coating/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
