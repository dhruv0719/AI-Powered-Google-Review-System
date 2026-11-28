/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiDraftAssistant } from './AiDraftAssistant.js';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { ErrorCodes } from '@review-system/shared';

describe('AiDraftAssistant Component', () => {
  const defaultProps = {
    code: 'q_testCampaign123',
    feedbackText: 'The car detailing was done with great care and attention to detail.',
    rating: 5,
    serviceIds: ['srv_1', 'srv_2'],
    googleReviewUrl: 'https://g.page/r/test/review',
    brandColor: '#2563EB',
    disabled: false,
    onApplyDraft: vi.fn(),
    onRevertDraft: vi.fn(),
    hasAppliedDraft: false,
    onGeneratingChange: vi.fn(),
    onEnsureSession: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Validation and Generation Action
  // =========================================================================
  it('1a. should show validation error when rating is not selected upon clicking Polish button', () => {
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft');
    render(<AiDraftAssistant {...defaultProps} rating={null} />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(screen.getByTestId('ai-rating-validation-error')).toHaveTextContent(
      'Please select an experience rating before polishing with AI.'
    );
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('1b. should enable Polish button and generate review even when feedback is empty', async () => {
    const mockResponse = {
      status: 'generated' as const,
      draft: 'The car detailing was executed with meticulous attention to detail.',
      generationsRemaining: 2,
      isReplay: false,
    };
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue(mockResponse);

    render(<AiDraftAssistant {...defaultProps} feedbackText="" />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith(
        'q_testCampaign123',
        expect.objectContaining({
          feedback: '',
          rating: 5,
          serviceIds: ['srv_1', 'srv_2'],
        })
      );
    });
    expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
  });

  it('1c. should enable Polish button and generate review with short comments (< 10 graphemes)', async () => {
    const mockResponse = {
      status: 'generated' as const,
      draft: 'The car detailing was executed with meticulous attention to detail.',
      generationsRemaining: 2,
      isReplay: false,
    };
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue(mockResponse);

    render(<AiDraftAssistant {...defaultProps} feedbackText="Good job" />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith(
        'q_testCampaign123',
        expect.objectContaining({
          feedback: 'Good job',
          rating: 5,
          serviceIds: ['srv_1', 'srv_2'],
        })
      );
    });
    expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
  });

  it('1d. should gracefully disable AI generation with a clear message when Intl.Segmenter is unavailable', () => {
    const originalSegmenter = (Intl as any).Segmenter;
    try {
      // Simulate legacy browser environment without Intl.Segmenter
      // @ts-ignore
      delete Intl.Segmenter;

      render(
        <AiDraftAssistant {...defaultProps} feedbackText="Valid feedback of plenty length" />
      );

      const button = screen.getByRole('button', { name: /polish with ai/i });
      expect(button).toBeDisabled();

      expect(screen.getByTestId('ai-unsupported-browser-hint')).toHaveTextContent(
        'AI review assistant is not supported in this browser. Please update your browser to use this feature.'
      );
      expect(screen.queryByTestId('ai-min-chars-hint')).not.toBeInTheDocument();
    } finally {
      // Restore Intl.Segmenter
      (Intl as any).Segmenter = originalSegmenter;
    }
  });

  it('2. should enable Polish button when feedback is 10 or more characters and trigger generation on click', async () => {
    const mockResponse = {
      status: 'generated' as const,
      draft: 'The car detailing was executed with meticulous attention to detail.',
      generationsRemaining: 2,
      isReplay: false,
    };
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue(mockResponse);

    render(<AiDraftAssistant {...defaultProps} />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith(
        'q_testCampaign123',
        expect.objectContaining({
          clientDraftId: expect.any(String),
          feedback: defaultProps.feedbackText,
          rating: 5,
          serviceIds: ['srv_1', 'srv_2'],
        })
      );
    });

    expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    expect(screen.getByTestId('ai-draft-text')).toHaveValue(mockResponse.draft);
  });

  // =========================================================================
  // 2. Generating State and Callback
  // =========================================================================
  it('3. should notify onGeneratingChange and display accessible loading announcement during generation', async () => {
    let resolveApi!: (val: any) => void;
    const apiPromise = new Promise((resolve) => {
      resolveApi = resolve;
    });
    vi.spyOn(publicApi, 'generateAiDraft').mockReturnValue(apiPromise as any);

    const onGeneratingChange = vi.fn();
    render(<AiDraftAssistant {...defaultProps} onGeneratingChange={onGeneratingChange} />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    fireEvent.click(button);

    expect(onGeneratingChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('ai-generating-indicator')).toHaveTextContent(
      'Polishing your feedback into a review draft...'
    );
    expect(button).toBeDisabled();

    // Resolve API
    resolveApi({
      status: 'generated',
      draft: 'Polished draft result',
      generationsRemaining: 2,
      isReplay: false,
    });

    await waitFor(() => {
      expect(onGeneratingChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByTestId('ai-generating-indicator')).not.toBeInTheDocument();
  });

  // =========================================================================
  // 3. Insufficient Context Handling (200 OK, draft: null)
  // =========================================================================
  it('4. should render friendly guidance and preserve quota when backend returns insufficient_context', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'insufficient_context',
      draft: null,
      generationsRemaining: 3,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-insufficient-context')).toBeInTheDocument();
    });

    expect(screen.getByTestId('ai-insufficient-context')).toHaveTextContent(
      'To help the AI assistant write a helpful review, please add a bit more detail'
    );
    // Draft card should not be shown
    expect(screen.queryByTestId('ai-draft-card')).not.toBeInTheDocument();
    // Quota remains 3
    expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent('3 drafts remaining');
  });

  // =========================================================================
  // 4. Quota Presentation: Neutral Initially, Authoritative on Response
  // =========================================================================
  it('5. should display neutral quota wording initially, then exact count after authoritative response', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Polished draft text',
      generationsRemaining: 1,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    // Initially unauthoritative
    expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent(
      'Up to 3 AI drafts per visit'
    );

    // Trigger generation
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent('1 draft remaining');
    });
  });

  it('6. should disable Polish button and announce limit reached when quota is 0', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Final third draft',
      generationsRemaining: 0,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent(
        'Draft limit reached (3/3 used)'
      );
    });

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).toBeDisabled();
  });

  // =========================================================================
  // 5. Compulsory Service Selection Validation
  // =========================================================================
  it('7. should validate that at least one service is selected before polishing', async () => {
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft');

    render(<AiDraftAssistant {...defaultProps} serviceIds={[]} />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    fireEvent.click(button);

    expect(screen.getByTestId('ai-service-validation-error')).toHaveTextContent(
      'Please select at least one service before polishing with AI.'
    );
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('8. should clear service validation error when serviceIds are provided', async () => {
    vi.spyOn(publicApi, 'generateAiDraft');

    const { rerender } = render(<AiDraftAssistant {...defaultProps} serviceIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    expect(screen.getByTestId('ai-service-validation-error')).toBeInTheDocument();

    rerender(<AiDraftAssistant {...defaultProps} serviceIds={['srv_1']} />);
    expect(screen.queryByTestId('ai-service-validation-error')).not.toBeInTheDocument();
  });

  // =========================================================================
  // 6. Action 1: Regenerate
  // =========================================================================
  it('9. should trigger Regenerate to request a new draft without erasing customer input', async () => {
    let callCount = 0;
    vi.spyOn(publicApi, 'generateAiDraft').mockImplementation(async () => {
      callCount++;
      return {
        status: 'generated',
        draft: callCount === 1 ? 'First draft generated.' : 'Second regenerated draft.',
        generationsRemaining: callCount === 1 ? 2 : 1,
        isReplay: false,
      };
    });

    render(<AiDraftAssistant {...defaultProps} />);

    // 1st generation
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-draft-text')).toHaveValue('First draft generated.');
    expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent('2 drafts remaining');

    // Click Regenerate
    const regenerateBtn = screen.getByTestId('ai-regenerate-button');
    expect(regenerateBtn).toBeInTheDocument();
    fireEvent.click(regenerateBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-text')).toHaveValue('Second regenerated draft.');
    });
    expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent('1 draft remaining');
    expect(callCount).toBe(2);

    // Verify both generation and regeneration used the original customer feedback, not the draft
    expect(publicApi.generateAiDraft).toHaveBeenNthCalledWith(
      1,
      defaultProps.code,
      expect.objectContaining({
        feedback: defaultProps.feedbackText,
        rating: defaultProps.rating,
        serviceIds: defaultProps.serviceIds,
      })
    );
    expect(publicApi.generateAiDraft).toHaveBeenNthCalledWith(
      2,
      defaultProps.code,
      expect.objectContaining({
        feedback: defaultProps.feedbackText,
        rating: defaultProps.rating,
        serviceIds: defaultProps.serviceIds,
      })
    );
  });

  it('9b. should use original customer feedback on regenerate even if customer manually edited the draft text', async () => {
    let callCount = 0;
    const generateSpy = vi.spyOn(publicApi, 'generateAiDraft').mockImplementation(async () => {
      callCount++;
      return {
        status: 'generated',
        draft: callCount === 1 ? 'First draft generated.' : 'Fresh regenerated draft from original input.',
        generationsRemaining: callCount === 1 ? 2 : 1,
        isReplay: false,
      };
    });

    render(<AiDraftAssistant {...defaultProps} />);

    // 1st generation
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    // Customer manually edits the draft text
    const draftTextarea = screen.getByTestId('ai-draft-text');
    fireEvent.change(draftTextarea, {
      target: { value: 'Customer edited draft text manually in the preview box.' },
    });
    expect(draftTextarea).toHaveValue('Customer edited draft text manually in the preview box.');

    // Click Regenerate
    fireEvent.click(screen.getByTestId('ai-regenerate-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-text')).toHaveValue(
        'Fresh regenerated draft from original input.'
      );
    });

    // Verify 2nd call used original feedbackText rather than the manually edited draft
    expect(generateSpy).toHaveBeenNthCalledWith(
      2,
      defaultProps.code,
      expect.objectContaining({
        feedback: defaultProps.feedbackText,
      })
    );
    expect(generateSpy).not.toHaveBeenNthCalledWith(
      2,
      defaultProps.code,
      expect.objectContaining({
        feedback: 'Customer edited draft text manually in the preview box.',
      })
    );
  });

  it('10. should disable Regenerate button when quota is exhausted', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Last possible draft.',
      generationsRemaining: 0,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    const regenerateBtn = screen.getByTestId('ai-regenerate-button');
    expect(regenerateBtn).toBeDisabled();
    expect(screen.getByTestId('ai-quota-indicator')).toHaveTextContent(
      'Draft limit reached (3/3 used)'
    );
  });

  it('10b. should display out-of-sync warning and disable Post on Google when rating or services or comments change', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Initial draft for 5-star experience.',
      generationsRemaining: 2,
      isReplay: false,
    });

    const { rerender } = render(<AiDraftAssistant {...defaultProps} rating={5} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('ai-draft-out-of-sync-notice')).not.toBeInTheDocument();
    const postBtn = screen.getByTestId('post-to-google-button');
    expect(postBtn).not.toBeDisabled();

    // 1. Change rating to 4
    rerender(<AiDraftAssistant {...defaultProps} rating={4} />);
    expect(screen.getByTestId('ai-draft-out-of-sync-notice')).toBeInTheDocument();
    expect(screen.getByTestId('ai-draft-out-of-sync-notice')).toHaveTextContent(
      'Your rating, services, or comments have changed. Please tap Regenerate'
    );
    expect(screen.getByTestId('post-to-google-button')).toBeDisabled();

    // 2. Restore rating back to 5 -> notice disappears and button re-enabled!
    rerender(<AiDraftAssistant {...defaultProps} rating={5} />);
    expect(screen.queryByTestId('ai-draft-out-of-sync-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-to-google-button')).not.toBeDisabled();

    // 3. Change services
    rerender(<AiDraftAssistant {...defaultProps} serviceIds={['srv_1']} />);
    expect(screen.getByTestId('ai-draft-out-of-sync-notice')).toBeInTheDocument();
    expect(screen.getByTestId('post-to-google-button')).toBeDisabled();

    // 4. Change comments
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        serviceIds={['srv_1', 'srv_2']}
        feedbackText="Different feedback"
      />
    );
    expect(screen.getByTestId('ai-draft-out-of-sync-notice')).toBeInTheDocument();
    expect(screen.getByTestId('post-to-google-button')).toBeDisabled();
  });

  // =========================================================================
  // 7. Retry, Idempotency, and Ambiguous Error Handling
  // =========================================================================
  it('11. should preserve pending request ID and payload for manual retry on transient failure', async () => {
    let callCount = 0;
    const capturedDraftIds: string[] = [];

    vi.spyOn(publicApi, 'generateAiDraft').mockImplementation(async (_code, payload) => {
      callCount++;
      capturedDraftIds.push(payload.clientDraftId);
      if (callCount === 1) {
        throw new PublicApiError(
          'AI provider timed out',
          504,
          ErrorCodes.AI_PROVIDER_UNAVAILABLE
        );
      }
      return {
        status: 'generated',
        draft: 'Polished draft after retry',
        generationsRemaining: 2,
        isReplay: false,
      };
    });

    render(<AiDraftAssistant {...defaultProps} />);

    // 1st attempt: fails with 504
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent('temporarily unavailable');
    });

    const retryBtn = screen.getByTestId('ai-retry-button');
    expect(retryBtn).toBeInTheDocument();

    // Manual click Retry
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    // Verification: Both calls must have used the EXACT same clientDraftId!
    expect(capturedDraftIds).toHaveLength(2);
    expect(capturedDraftIds[0]).toBe(capturedDraftIds[1]);
  });

  it('11b. should handle RATE_LIMITED by preserving request ID and payload, imposing cooldown, and enabling manual retry after wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let callCount = 0;
      const capturedDraftIds: string[] = [];

      vi.spyOn(publicApi, 'generateAiDraft').mockImplementation(async (_code, payload) => {
        callCount++;
        capturedDraftIds.push(payload.clientDraftId);
        if (callCount === 1) {
          throw new PublicApiError('Rate limited', 429, ErrorCodes.RATE_LIMITED);
        }
        return {
          status: 'generated',
          draft: 'Draft after rate limit cooldown',
          generationsRemaining: 2,
          isReplay: false,
        };
      });

      render(<AiDraftAssistant {...defaultProps} />);

      // 1st attempt: fails with 429
      fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

      await waitFor(() => {
        expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
          'Too many draft requests. Please wait a minute before trying again.'
        );
      });

      const retryBtn = screen.getByTestId('ai-retry-button');
      expect(retryBtn).toBeInTheDocument();
      // Retry button is temporarily disabled during cooldown to prevent spamming
      expect(retryBtn).toBeDisabled();
      expect(retryBtn).toHaveTextContent('Please wait a moment...');

      // Advance timers by 30s: cooldown is 60s, so it must still be disabled
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(retryBtn).toBeDisabled();
      expect(retryBtn).toHaveTextContent('Please wait a moment...');

      // Advance timers by remaining 30s (total 60s)
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(retryBtn).not.toBeDisabled();
      expect(retryBtn).toHaveTextContent('Retry');

      // Manual click Retry
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
      });

      // Verification: preserved identical clientDraftId!
      expect(capturedDraftIds).toHaveLength(2);
      expect(capturedDraftIds[0]).toBe(capturedDraftIds[1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('11c. should handle OUTPUT_GUARDRAIL_FAILED as safely retryable with identical clientDraftId and payload', async () => {
    let callCount = 0;
    const capturedDraftIds: string[] = [];

    vi.spyOn(publicApi, 'generateAiDraft').mockImplementation(async (_code, payload) => {
      callCount++;
      capturedDraftIds.push(payload.clientDraftId);
      if (callCount === 1) {
        throw new PublicApiError(
          'Output guardrail failed',
          502,
          ErrorCodes.OUTPUT_GUARDRAIL_FAILED
        );
      }
      return {
        status: 'generated',
        draft: 'Polished draft after guardrail retry',
        generationsRemaining: 2,
        isReplay: false,
      };
    });

    render(<AiDraftAssistant {...defaultProps} />);

    // 1st attempt: fails with 502 OUTPUT_GUARDRAIL_FAILED
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        "We couldn't generate a suitable draft from this feedback. Tap Retry to try again, or adjust your feedback."
      );
    });

    const retryBtn = screen.getByTestId('ai-retry-button');
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    // Manual click Retry
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    // Verification: Both calls used the EXACT same clientDraftId!
    expect(capturedDraftIds).toHaveLength(2);
    expect(capturedDraftIds[0]).toBe(capturedDraftIds[1]);
  });

  it('12. should never automatically retry on failure', async () => {
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockRejectedValue(
      new PublicApiError('Provider 500', 502, ErrorCodes.AI_PROVIDER_UNAVAILABLE)
    );

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toBeInTheDocument();
    });

    // Exactly 1 call was made; no automatic second call
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });

  it('13. should handle IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH without auto-retrying or creating silent drafts', async () => {
    const apiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockRejectedValue(
      new PublicApiError(
        'Payload mismatch',
        409,
        ErrorCodes.IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH
      )
    );

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        'Your comments were updated during draft generation'
      );
    });

    // Retry button MUST NOT be present for payload mismatch
    expect(screen.queryByTestId('ai-retry-button')).not.toBeInTheDocument();
    // Exactly 1 call was made
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });

  it('14. should handle INVALID_SESSION without automatic session renewal', async () => {
    const sessionSpy = vi.spyOn(publicApi, 'createPublicSession');
    vi.spyOn(publicApi, 'generateAiDraft').mockRejectedValue(
      new PublicApiError('Session expired', 401, ErrorCodes.INVALID_SESSION)
    );

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        'Your review session has expired. Please refresh the page'
      );
    });

    // Did NOT silently call createPublicSession
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-retry-button')).not.toBeInTheDocument();
  });

  // =========================================================================
  // 8. Action 2: Post on Google (Tab Reservation, Clipboard & Navigation)
  // =========================================================================
  it('15. should copy draft text and navigate reserved tab to the validated business Google Review URL', async () => {
    const draftText = 'Polished draft text ready for Google.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    const mockTab = {
      location: { href: '' },
      close: vi.fn(),
      closed: false,
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockTab as any);

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const postBtn = screen.getByTestId('post-to-google-button');
    expect(postBtn).toBeInTheDocument();
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(draftText);
    });

    // Synchronously reserved tab was opened
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    // Tab was navigated to validated business Google Review URL
    expect(mockTab.location.href).toBe('https://g.page/r/test/review');
    expect(mockTab.close).not.toHaveBeenCalled();

    // Confirmation toast displayed
    expect(screen.getByTestId('ai-post-copied-toast')).toBeInTheDocument();
    expect(screen.getByTestId('ai-post-copied-toast')).toHaveTextContent(
      'Draft copied! Google Reviews opened in a new tab.'
    );
  });

  it('15b. should initiate clipboard writing synchronously before window.open to preserve user gesture and focus', async () => {
    const draftText = 'Order test draft text.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const callOrder: string[] = [];
    const writeTextSpy = vi.fn().mockImplementation(() => {
      callOrder.push('clipboard.writeText');
      return Promise.resolve();
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    const mockTab = {
      location: { href: '' },
      close: vi.fn(),
      closed: false,
    };
    vi.spyOn(window, 'open').mockImplementation(() => {
      callOrder.push('window.open');
      return mockTab as any;
    });

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('post-to-google-button'));

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(draftText);
    });

    // Proves writeText was initiated BEFORE window.open
    expect(callOrder).toEqual(['clipboard.writeText', 'window.open']);
  });

  it('15c. should never call readText, read, or query clipboard-read permission', async () => {
    const draftText = 'No clipboard read test.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const readTextSpy = vi.fn();
    const readSpy = vi.fn();
    const querySpy = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: readTextSpy,
        read: readSpy,
      },
      permissions: {
        query: querySpy,
      },
    });
    const mockTab = { location: { href: '' }, close: vi.fn(), closed: false };
    vi.spyOn(window, 'open').mockReturnValue(mockTab as any);

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('post-to-google-button'));

    await waitFor(() => {
      expect(mockTab.location.href).toBe('https://g.page/r/test/review');
    });

    // Assert strictly WRITE-only clipboard interaction
    expect(readTextSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('16. should close reserved blank tab, NOT navigate, and show clear manual copy instructions when clipboard copy fails', async () => {
    const draftText = 'Polished draft text.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const writeTextSpy = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });
    // DOM fallback copy also fails
    document.execCommand = vi.fn().mockReturnValue(false);

    const mockTab = {
      location: { href: '' },
      close: vi.fn(),
      closed: false,
    };
    vi.spyOn(window, 'open').mockReturnValue(mockTab as any);

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const postBtn = screen.getByTestId('post-to-google-button');
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-copy-failed-alert')).toBeInTheDocument();
    });

    // Reserved tab was closed upon clipboard failure!
    expect(mockTab.close).toHaveBeenCalledTimes(1);
    // Location was NOT navigated to Google!
    expect(mockTab.location.href).toBe('');

    // Error alert informs user that automatic copying failed
    const alert = screen.getByTestId('ai-copy-failed-alert');
    expect(alert).toHaveTextContent('Draft could not be automatically copied to clipboard');

    // Direct link to Google Reviews is provided
    const continueLink = screen.getByTestId('copy-failed-google-link');
    expect(continueLink).toHaveAttribute('href', 'https://g.page/r/test/review');
    expect(continueLink).toHaveAttribute('target', '_blank');

    // Textarea remains editable with the draft text intact
    const textarea = screen.getByTestId('ai-draft-text');
    expect(textarea).toHaveValue(draftText);

    // UI does NOT claim that draft was copied to clipboard
    expect(screen.queryByTestId('ai-post-copied-toast')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your review draft will be copied to your clipboard/i)).not.toBeInTheDocument();
  });

  // =========================================================================
  // 9. Feature Disabled (503) Graceful Degradation
  // =========================================================================
  it('17. should gracefully render nothing when FEATURE_DISABLED is returned', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockRejectedValue(
      new PublicApiError('Feature disabled', 503, ErrorCodes.FEATURE_DISABLED)
    );

    const { container } = render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('ai-draft-assistant')).not.toBeInTheDocument();
    });
    expect(container.firstChild).toBeNull();
  });

  // =========================================================================
  // 10. Direct Editing, Popup Blocker Fallback, URL Security, and Action Buttons
  // =========================================================================
  it('18. should support direct editing of generated draft text and Post on Google copies latest edited text', async () => {
    const originalDraft = 'Original AI draft text.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: originalDraft,
      generationsRemaining: 2,
      isReplay: false,
    });

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });
    const mockTab = { location: { href: '' }, close: vi.fn(), closed: false };
    vi.spyOn(window, 'open').mockReturnValue(mockTab as any);

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    // Verify draft appears directly in editable textarea
    const draftTextarea = screen.getByTestId('ai-draft-text');
    expect(draftTextarea).toHaveValue(originalDraft);

    // Customer directly edits draft in the preview card
    fireEvent.change(draftTextarea, {
      target: { value: 'Customer customized and polished review!' },
    });
    expect(draftTextarea).toHaveValue('Customer customized and polished review!');

    // Click Post on Google
    fireEvent.click(screen.getByTestId('post-to-google-button'));

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('Customer customized and polished review!');
    });
  });

  it('18b. should expose a direct Google link through existing action control when browser blocks initial tab (popup-blocker fallback)', async () => {
    const draftText = 'Review draft ready for fallback test.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });
    // Simulate browser popup blocker returning null on window.open
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const postBtn = screen.getByTestId('post-to-google-button');
    expect(postBtn.tagName).toBe('BUTTON');

    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(draftText);
    });

    // Control transitions to direct link without adding a third button
    const directLink = screen.getByTestId('post-to-google-button');
    expect(directLink.tagName).toBe('A');
    expect(directLink).toHaveAttribute('href', 'https://g.page/r/test/review');
    expect(directLink).toHaveAttribute('target', '_blank');
    expect(directLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(directLink).toHaveTextContent(/Continue to Google Reviews/i);

    // Toast indicates copied and prompts tap on direct link
    expect(screen.getByTestId('ai-post-copied-toast')).toHaveTextContent(
      'Draft copied to clipboard! Tap Continue to Google Reviews below to publish.'
    );
  });

  it('18c. should reject unsafe review URLs without opening or navigating to them', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Draft with malicious url test.',
      generationsRemaining: 2,
      isReplay: false,
    });

    const openSpy = vi.spyOn(window, 'open');

    // Unsafe javascript: URI
    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="javascript:alert(1)" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('post-to-google-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        'A valid Google Review URL is not configured for this location.'
      );
    });

    // Did NOT attempt to navigate to javascript: URI
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('18d. should contain exactly two final action buttons and NO separate Copy, Open, Apply, Revert, Discard or Edit Text buttons', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Clean two-button draft.',
      generationsRemaining: 2,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const draftCard = screen.getByTestId('ai-draft-card');
    const buttons = draftCard.querySelectorAll('button');

    // Exactly two buttons: Regenerate and Post on Google
    expect(buttons).toHaveLength(2);
    expect(screen.getByTestId('ai-regenerate-button')).toBeInTheDocument();
    expect(screen.getByTestId('post-to-google-button')).toBeInTheDocument();

    // Verify all legacy/removed buttons are strictly absent
    expect(screen.queryByTestId('ai-edit-toggle-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-copy-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-open-google-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-apply-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-revert-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-discard-button')).not.toBeInTheDocument();
  });

  it('19. should notify onDraftChange when draft is generated and edited', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Generated draft result.',
      generationsRemaining: 2,
      isReplay: false,
    });

    const onDraftChange = vi.fn();
    render(<AiDraftAssistant {...defaultProps} onDraftChange={onDraftChange} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    expect(onDraftChange).toHaveBeenCalledWith('Generated draft result.');

    // Direct edit triggers onDraftChange
    fireEvent.change(screen.getByTestId('ai-draft-text'), {
      target: { value: 'Generated draft result with customer tweak.' },
    });
    expect(onDraftChange).toHaveBeenCalledWith('Generated draft result with customer tweak.');
  });

  // =========================================================================
  // 11. Generation Lifecycle & Unmount Cleanup
  // =========================================================================
  it('20. should notify parent with onGeneratingChange(false) if unmounted during active generation and request resolves', async () => {
    let resolveAi!: (value: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveAi = resolve;
    });
    vi.spyOn(publicApi, 'generateAiDraft').mockReturnValue(pendingPromise as any);

    const onGeneratingChange = vi.fn();
    const { unmount } = render(
      <AiDraftAssistant {...defaultProps} onGeneratingChange={onGeneratingChange} />
    );

    // Initial state: not called
    expect(onGeneratingChange).not.toHaveBeenCalled();

    // Trigger AI draft generation
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    // Generation starts: parent is notified with true
    expect(onGeneratingChange).toHaveBeenCalledTimes(1);
    expect(onGeneratingChange).toHaveBeenLastCalledWith(true);

    // Unmount while generation is active
    unmount();

    // Parent must receive onGeneratingChange(false) promptly upon unmount
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
    expect(onGeneratingChange).toHaveBeenLastCalledWith(false);

    // Later, the background request resolves
    await act(async () => {
      resolveAi({
        status: 'generated',
        draft: 'Draft arrived after unmount.',
        generationsRemaining: 2,
        isReplay: false,
      });
    });

    // Zero duplicate notifications: call count remains exactly 2
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
  });

  it('21. should notify parent with onGeneratingChange(false) if unmounted during active generation and request rejects', async () => {
    let rejectAi!: (reason: any) => void;
    const pendingPromise = new Promise((_, reject) => {
      rejectAi = reject;
    });
    pendingPromise.catch(() => {});
    vi.spyOn(publicApi, 'generateAiDraft').mockReturnValue(pendingPromise as any);

    const onGeneratingChange = vi.fn();
    const { unmount } = render(
      <AiDraftAssistant {...defaultProps} onGeneratingChange={onGeneratingChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    expect(onGeneratingChange).toHaveBeenCalledTimes(1);
    expect(onGeneratingChange).toHaveBeenLastCalledWith(true);

    // Unmount while generation is active
    unmount();

    // Prompt cleanup
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
    expect(onGeneratingChange).toHaveBeenLastCalledWith(false);

    // Later, the background request rejects
    await act(async () => {
      rejectAi(new PublicApiError('AI provider down', 504, ErrorCodes.AI_PROVIDER_UNAVAILABLE));
    });

    // Zero duplicate notifications: call count remains exactly 2
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
  });

  it('22. should not trigger extra onGeneratingChange notifications on unmount if generation already completed normally', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Completed draft.',
      generationsRemaining: 2,
      isReplay: false,
    });

    const onGeneratingChange = vi.fn();
    const { unmount } = render(
      <AiDraftAssistant {...defaultProps} onGeneratingChange={onGeneratingChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    // Normal lifecycle: called with true on start, false on completion
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
    expect(onGeneratingChange).toHaveBeenNthCalledWith(1, true);
    expect(onGeneratingChange).toHaveBeenNthCalledWith(2, false);

    // Unmounting afterward must NOT emit any extra notifications
    unmount();
    expect(onGeneratingChange).toHaveBeenCalledTimes(2);
  });

  it('23. should await onEnsureSession before calling generateAiDraft and block duplicate clicks while pending', async () => {
    let resolveSession!: (value: boolean) => void;
    const sessionPromise = new Promise<boolean>((resolve) => {
      resolveSession = resolve;
    });
    const onEnsureSession = vi.fn().mockReturnValue(sessionPromise);
    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Completed draft after session wait.',
      generationsRemaining: 2,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} onEnsureSession={onEnsureSession} />);

    const polishBtn = screen.getByRole('button', { name: /polish with ai/i });
    // First click starts process
    fireEvent.click(polishBtn);

    expect(onEnsureSession).toHaveBeenCalledTimes(1);
    // AI generation has NOT started yet
    expect(aiSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Polishing Draft...')).toBeInTheDocument();

    // Rapid second click while session is pending must be rejected by isGenerating lock
    fireEvent.click(polishBtn);
    expect(onEnsureSession).toHaveBeenCalledTimes(1);
    expect(aiSpy).not.toHaveBeenCalled();

    // Now resolve the session promise
    await act(async () => {
      resolveSession(true);
    });

    await waitFor(() => {
      expect(aiSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('24. should not call generateAiDraft if onEnsureSession returns false and display actionable error', async () => {
    const onEnsureSession = vi.fn().mockResolvedValue(false);
    const aiSpy = vi.spyOn(publicApi, 'generateAiDraft');

    render(<AiDraftAssistant {...defaultProps} onEnsureSession={onEnsureSession} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-error-notice')).toHaveTextContent(
        'Unable to start a review session. Please check your connection and try again.'
      );
    });

    expect(aiSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-retry-button')).toBeInTheDocument();
  });
});
