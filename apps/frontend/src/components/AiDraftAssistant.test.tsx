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
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Threshold Activation and Explicit Generation Action
  // =========================================================================
  it('1a. should disable Polish button when feedback is fewer than 10 ordinary characters', () => {
    render(<AiDraftAssistant {...defaultProps} feedbackText="Good food" />);

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('ai-min-chars-hint')).toHaveTextContent(
      'Enter at least 10 characters to polish with AI.'
    );
  });

  it('1b. should count Unicode combining characters as user-perceived graphemes', () => {
    // 9 combining characters ('e' + combining acute = 1 grapheme, 2 code units)
    // String length is 18 UTF-16 code units, but exactly 9 graphemes
    const nineCombiningChars = 'e\u0301'.repeat(9);
    const { rerender } = render(
      <AiDraftAssistant {...defaultProps} feedbackText={nineCombiningChars} />
    );

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('ai-min-chars-hint')).toBeInTheDocument();

    // 10 combining characters (20 code units, exactly 10 graphemes)
    const tenCombiningChars = 'e\u0301'.repeat(10);
    rerender(<AiDraftAssistant {...defaultProps} feedbackText={tenCombiningChars} />);
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('ai-min-chars-hint')).not.toBeInTheDocument();
  });

  it('1c. should count complex emojis and flags as user-perceived graphemes', () => {
    // Family emoji: '👨‍👩‍👧‍👦' (11 UTF-16 code units with ZWJ, exactly 1 grapheme)
    // 5 family emojis = 55 UTF-16 code units, but only 5 graphemes
    const fiveComplexEmojis = '👨‍👩‍👧‍👦'.repeat(5);
    const { rerender } = render(
      <AiDraftAssistant {...defaultProps} feedbackText={fiveComplexEmojis} />
    );

    const button = screen.getByRole('button', { name: /polish with ai/i });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('ai-min-chars-hint')).toBeInTheDocument();

    // 10 family emojis = 110 UTF-16 code units, exactly 10 graphemes
    const tenComplexEmojis = '👨‍👩‍👧‍👦'.repeat(10);
    rerender(<AiDraftAssistant {...defaultProps} feedbackText={tenComplexEmojis} />);
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('ai-min-chars-hint')).not.toBeInTheDocument();

    // Flag emoji: '🇺🇸' (4 UTF-16 code units, exactly 1 grapheme)
    // 9 flag emojis = 36 code units, 9 graphemes
    const nineFlagEmojis = '🇺🇸'.repeat(9);
    rerender(<AiDraftAssistant {...defaultProps} feedbackText={nineFlagEmojis} />);
    expect(button).toBeDisabled();

    // 10 flag emojis = 40 code units, 10 graphemes
    const tenFlagEmojis = '🇺🇸'.repeat(10);
    rerender(<AiDraftAssistant {...defaultProps} feedbackText={tenFlagEmojis} />);
    expect(button).not.toBeDisabled();
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
    expect(screen.getByTestId('ai-draft-text')).toHaveTextContent(mockResponse.draft);
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
  // 5. Apply and Pre-Apply Snapshot Revert Rule
  // =========================================================================
  it('7. should capture exact pre-Apply snapshot and restore it on Revert', async () => {
    const draftText = 'AI polished draft version.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const onApplyDraft = vi.fn();
    const onRevertDraft = vi.fn();

    const currentFeedback = 'My custom drafted note about the service.';
    const { rerender } = render(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={currentFeedback}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={false}
      />
    );

    // Generate draft
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument();
    });

    // Click Apply
    fireEvent.click(screen.getByTestId('ai-apply-button'));
    expect(onApplyDraft).toHaveBeenCalledWith(draftText);

    // Simulate parent updating hasAppliedDraft and feedbackText
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={draftText}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={true}
      />
    );

    // Revert button should now be rendered
    const revertBtn = screen.getByTestId('ai-revert-button');
    expect(revertBtn).toBeInTheDocument();

    // Click Revert
    fireEvent.click(revertBtn);
    // MUST restore the exact pre-Apply snapshot!
    expect(onRevertDraft).toHaveBeenCalledWith(currentFeedback);
  });

  it('8. should correctly handle multiple Apply and Revert cycles with updated pre-Apply snapshots', async () => {
    const draftText = 'AI polished draft version.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const onApplyDraft = vi.fn();
    const onRevertDraft = vi.fn();

    const initialText = 'First version of customer feedback.';
    const { rerender } = render(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={initialText}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={false}
      />
    );

    // 1. Generate & Apply Cycle 1
    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('ai-apply-button'));
    expect(onApplyDraft).toHaveBeenCalledWith(draftText);

    // Revert Cycle 1
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={draftText}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={true}
      />
    );
    fireEvent.click(screen.getByTestId('ai-revert-button'));
    expect(onRevertDraft).toHaveBeenCalledWith(initialText);

    // 2. Customer modifies text to Version 2 before Apply Cycle 2
    const versionTwoText = 'Second modified version of customer feedback.';
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={versionTwoText}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={false}
      />
    );

    // Apply Cycle 2
    fireEvent.click(screen.getByTestId('ai-apply-button'));
    expect(onApplyDraft).toHaveBeenCalledWith(draftText);

    // Revert Cycle 2 MUST restore Version 2, NOT initialText!
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText={draftText}
        onApplyDraft={onApplyDraft}
        onRevertDraft={onRevertDraft}
        hasAppliedDraft={true}
      />
    );
    fireEvent.click(screen.getByTestId('ai-revert-button'));
    expect(onRevertDraft).toHaveBeenCalledWith(versionTwoText);
  });

  // =========================================================================
  // 6. Stale Detection Rules
  // =========================================================================
  it('9. should not show stale badge immediately after applying draft', async () => {
    const draftText = 'AI polished draft version.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const { rerender } = render(
      <AiDraftAssistant {...defaultProps} feedbackText="Original text" hasAppliedDraft={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('ai-apply-button'));

    // Parent updates feedbackText to draftText and hasAppliedDraft to true
    rerender(
      <AiDraftAssistant {...defaultProps} feedbackText={draftText} hasAppliedDraft={true} />
    );

    // Stale badge MUST NOT be present
    expect(screen.queryByTestId('ai-stale-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-applied-badge')).toBeInTheDocument();
  });

  it('10. should mark draft stale when text, rating, or services change', async () => {
    const draftText = 'AI polished draft version.';
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: draftText,
      generationsRemaining: 2,
      isReplay: false,
    });

    const { rerender } = render(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText="Initial feedback"
        rating={5}
        serviceIds={['srv_1']}
        hasAppliedDraft={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    // 1. Text change -> Stale
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText="Modified feedback text"
        rating={5}
        serviceIds={['srv_1']}
        hasAppliedDraft={false}
      />
    );
    expect(screen.getByTestId('ai-stale-badge')).toBeInTheDocument();

    // Restore text, change rating -> Stale
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText="Initial feedback"
        rating={4}
        serviceIds={['srv_1']}
        hasAppliedDraft={false}
      />
    );
    expect(screen.getByTestId('ai-stale-badge')).toBeInTheDocument();

    // Restore rating, change services -> Stale
    rerender(
      <AiDraftAssistant
        {...defaultProps}
        feedbackText="Initial feedback"
        rating={5}
        serviceIds={['srv_1', 'srv_2']}
        hasAppliedDraft={false}
      />
    );
    expect(screen.getByTestId('ai-stale-badge')).toBeInTheDocument();
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
  // 8. Clipboard Copy and Independent Google Review Action
  // =========================================================================
  it('15. should copy draft text to clipboard and display confirmation toast', async () => {
    const draftText = 'Polished draft text to be copied.';
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

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const copyBtn = screen.getByTestId('ai-copy-button');
    fireEvent.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalledWith(draftText);
    await waitFor(() => {
      expect(screen.getByTestId('ai-copy-button')).toHaveTextContent('Copied to Clipboard!');
    });
  });

  it('16. should provide independent Google Review link with safe external attributes', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Draft text',
      generationsRemaining: 2,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} googleReviewUrl="https://g.page/r/test/review" />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    const googleLink = screen.getByTestId('ai-open-google-button');
    expect(googleLink).toHaveAttribute('href', 'https://g.page/r/test/review');
    expect(googleLink).toHaveAttribute('target', '_blank');
    expect(googleLink).toHaveAttribute('rel', 'noopener noreferrer');
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
  // 10. Inline Edit Mode and Discard
  // =========================================================================
  it('18. should allow customer to edit draft inline and apply edited text', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Original AI draft.',
      generationsRemaining: 2,
      isReplay: false,
    });

    const onApplyDraft = vi.fn();
    render(<AiDraftAssistant {...defaultProps} onApplyDraft={onApplyDraft} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    // Enter edit mode
    fireEvent.click(screen.getByTestId('ai-edit-toggle-button'));

    const editTextarea = screen.getByTestId('ai-draft-edit-textarea');
    expect(editTextarea).toHaveValue('Original AI draft.');

    fireEvent.change(editTextarea, {
      target: { value: 'Original AI draft with my personal tweak.' },
    });

    // Apply edited text
    fireEvent.click(screen.getByTestId('ai-apply-button'));
    expect(onApplyDraft).toHaveBeenCalledWith('Original AI draft with my personal tweak.');
  });

  it('19. should clear draft preview card when Discard is clicked', async () => {
    vi.spyOn(publicApi, 'generateAiDraft').mockResolvedValue({
      status: 'generated',
      draft: 'Draft to discard.',
      generationsRemaining: 2,
      isReplay: false,
    });

    render(<AiDraftAssistant {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /polish with ai/i }));
    await waitFor(() => expect(screen.getByTestId('ai-draft-card')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('ai-discard-button'));

    expect(screen.queryByTestId('ai-draft-card')).not.toBeInTheDocument();
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
});
