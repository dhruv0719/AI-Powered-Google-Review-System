import { useState, useRef, useEffect } from 'react';
import {
  DraftGenerationRequestInput,
  ErrorCodes,
  isValidGoogleReviewUrl,
} from '@review-system/shared';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import {
  reserveExternalTab,
  navigateReservedTab,
  closeReservedTab,
  initiateClipboardWrite,
} from '../utils/googleReview.js';

export interface AiDraftAssistantProps {
  code: string;
  feedbackText: string;
  rating: number | null;
  serviceIds: string[];
  googleReviewUrl: string;
  brandColor?: string;
  disabled?: boolean;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onRequestSessionRenew?: () => Promise<boolean>;
  onEnsureSession: () => Promise<boolean>;
  onDraftChange?: (draftText: string | null) => void;
  // Preserved for backward compatibility with isolated tests
  onApplyDraft?: (draftText: string) => void;
  onRevertDraft?: (restoredText: string) => void;
  hasAppliedDraft?: boolean;
}

interface ActiveDraftState {
  clientDraftId: string;
  backendDraftText: string;
  generatedFeedback: string;
  generatedRating: number | null;
  generatedServiceIds: string[];
}

export function isGraphemeSupported(): boolean {
  return (
    typeof Intl !== 'undefined' &&
    'Segmenter' in Intl &&
    typeof (Intl as any).Segmenter === 'function'
  );
}

/**
 * Counts user-perceived grapheme clusters using Intl.Segmenter.
 * Handles Unicode combining diacritics, multi-byte code units, and complex ZWJ emojis.
 * Returns null if Intl.Segmenter is not supported by the environment.
 */
export function countGraphemes(text: string): number | null {
  if (!isGraphemeSupported()) {
    return null;
  }
  const normalized = text.normalize('NFC').trim();
  if (normalized.length === 0) return 0;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(normalized)).length;
}

export function AiDraftAssistant({
  code,
  feedbackText,
  rating,
  serviceIds,
  googleReviewUrl,
  brandColor = '#006764',
  disabled = false,
  onGeneratingChange,
  onRequestSessionRenew,
  onEnsureSession,
  onDraftChange,
  onApplyDraft,
}: AiDraftAssistantProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [authoritativeQuota, setAuthoritativeQuota] = useState<number | null>(null);
  const [activeDraft, setActiveDraft] = useState<ActiveDraftState | null>(null);
  const [insufficientContextNotice, setInsufficientContextNotice] = useState<string | null>(null);
  const [serviceValidationError, setServiceValidationError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isRenewingSession, setIsRenewingSession] = useState(false);
  const [isRateLimitedCooldown, setIsRateLimitedCooldown] = useState(false);
  const [isFeatureDisabled, setIsFeatureDisabled] = useState(false);
  const [editedDraftText, setEditedDraftText] = useState('');
  const [postState, setPostState] = useState<
    | { status: 'idle' }
    | { status: 'copied_and_opened' }
    | { status: 'popup_blocked' }
    | { status: 'copy_failed'; message: string }
    | { status: 'invalid_url'; message: string }
  >({ status: 'idle' });

  // Clear service validation error when services are selected
  useEffect(() => {
    if (serviceIds && serviceIds.length > 0) {
      setServiceValidationError(null);
    }
  }, [serviceIds]);

  // Preserves exact { clientDraftId, payload } for deterministic manual retries
  const pendingRequestRef = useRef<{
    clientDraftId: string;
    payload: DraftGenerationRequestInput;
  } | null>(null);

  // Synchronous generation lock to prevent duplicate concurrent calls
  const isGeneratingRef = useRef(false);

  // Tracks mounted state to prevent state updates and unmount leak
  const isMountedRef = useRef(true);

  // Keeps current reference to onGeneratingChange callback
  const onGeneratingChangeRef = useRef(onGeneratingChange);
  useEffect(() => {
    onGeneratingChangeRef.current = onGeneratingChange;
  }, [onGeneratingChange]);

  // Rate-limiting cooldown timer
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (rateLimitTimerRef.current) {
        clearTimeout(rateLimitTimerRef.current);
      }
      if (isGeneratingRef.current) {
        isGeneratingRef.current = false;
        onGeneratingChangeRef.current?.(false);
      }
    };
  }, []);

  const isBrowserSupported = isGraphemeSupported();
  // Grapheme length check for frontend activation
  const graphemeCount = isBrowserSupported ? countGraphemes(feedbackText) : null;
  const hasMinimumText =
    isBrowserSupported && graphemeCount !== null && graphemeCount >= 10;
  const isQuotaExhausted = authoritativeQuota === 0;

  const handleGenerate = async (isRetry = false) => {
    if (disabled || isGeneratingRef.current || isFeatureDisabled || !isBrowserSupported) {
      return;
    }

    // 1. Compulsory Service Selection Validation
    if (!serviceIds || serviceIds.length === 0) {
      setServiceValidationError('Please select at least one service before polishing with AI.');
      return;
    }
    setServiceValidationError(null);

    // 2. Minimum Text Validation
    if (!hasMinimumText) {
      return;
    }

    let payloadToSend: DraftGenerationRequestInput;

    if (isRetry) {
      if (!pendingRequestRef.current) return;
      payloadToSend = pendingRequestRef.current.payload;
    } else {
      if (isQuotaExhausted) return;

      const clientDraftId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      payloadToSend = {
        clientDraftId,
        feedback: feedbackText.trim(),
        rating: typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : undefined,
        serviceIds: serviceIds.length > 0 ? serviceIds : [],
        language: 'en',
      };

      pendingRequestRef.current = { clientDraftId, payload: payloadToSend };
    }

    isGeneratingRef.current = true;
    setIsGenerating(true);
    onGeneratingChangeRef.current?.(true);
    setErrorMessage(null);
    setInsufficientContextNotice(null);
    setIsRetryable(false);
    setIsSessionExpired(false);
    setPostState({ status: 'idle' });

    try {
      const sessionReady = await onEnsureSession();
      if (!isMountedRef.current) {
        return;
      }
      if (!sessionReady) {
        setErrorMessage(
          'Unable to start a review session. Please check your connection and try again.'
        );
        setIsRetryable(true);
        return;
      }

      const res = await publicApi.generateAiDraft(code, payloadToSend);

      if (!isMountedRef.current) {
        return;
      }

      setAuthoritativeQuota(res.generationsRemaining);

      if (res.status === 'insufficient_context' || !res.draft) {
        setInsufficientContextNotice(
          'To help the AI assistant write a helpful review, please add a bit more detail about your experience (e.g., what you ordered or which service you received).'
        );
        setActiveDraft(null);
        onDraftChange?.(null);
        pendingRequestRef.current = null;
      } else {
        setInsufficientContextNotice(null);
        setActiveDraft({
          clientDraftId: payloadToSend.clientDraftId,
          backendDraftText: res.draft,
          generatedFeedback: feedbackText,
          generatedRating: rating,
          generatedServiceIds: [...serviceIds],
        });
        setEditedDraftText(res.draft);
        setPostState({ status: 'idle' });
        onDraftChange?.(res.draft);
        onApplyDraft?.(res.draft);
        pendingRequestRef.current = null;
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) {
        return;
      }
      if (err instanceof PublicApiError) {
        switch (err.code) {
          case ErrorCodes.FEATURE_DISABLED:
            setIsFeatureDisabled(true);
            setErrorMessage(null);
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.INVALID_SESSION:
            setErrorMessage(
              onRequestSessionRenew
                ? 'Your review session has expired. Start a new session to continue.'
                : 'Your review session has expired. Please refresh the page to start a new session.'
            );
            setIsRetryable(false);
            setIsSessionExpired(true);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH:
            setErrorMessage(
              'Your comments were updated during draft generation. Tap "Polish with AI" to generate a draft for your updated comments.'
            );
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.QUOTA_EXCEEDED:
            setAuthoritativeQuota(0);
            setErrorMessage(
              'Draft generation limit reached (3 of 3 used). You can still edit your feedback and write a review on Google.'
            );
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.RATE_LIMITED:
            setErrorMessage('Too many draft requests. Please wait a minute before trying again.');
            setIsRetryable(true);
            setIsRateLimitedCooldown(true);
            if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
            rateLimitTimerRef.current = setTimeout(() => {
              setIsRateLimitedCooldown(false);
            }, 60_000);
            break;

          case ErrorCodes.CONCURRENT_GENERATION_IN_PROGRESS:
            setErrorMessage(
              'A review draft is currently being prepared. Please wait a moment and tap Retry.'
            );
            setIsRetryable(true);
            break;

          case ErrorCodes.OUTPUT_GUARDRAIL_FAILED:
            setErrorMessage(
              "We couldn't generate a suitable draft from this feedback. Tap Retry to try again, or adjust your feedback."
            );
            setIsRetryable(true);
            break;

          case ErrorCodes.AI_PROVIDER_UNAVAILABLE:
            setErrorMessage(
              'AI assistant is temporarily unavailable. Tap Retry to try again, or continue with your original text.'
            );
            setIsRetryable(true);
            break;

          case ErrorCodes.VALIDATION_ERROR:
            setErrorMessage(
              err.message || 'Feedback cannot exceed 500 characters to use the AI assistant.'
            );
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.CAMPAIGN_INACTIVE:
            setErrorMessage('This review campaign is currently inactive.');
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED:
            setErrorMessage('A Google Review URL is not configured for this location.');
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          case ErrorCodes.TENANT_SUSPENDED:
            setErrorMessage('This business service is currently unavailable.');
            setIsRetryable(false);
            setIsSessionExpired(false);
            pendingRequestRef.current = null;
            break;

          default:
            setErrorMessage(
              'Unable to polish draft due to an unexpected error. Tap Retry to try again.'
            );
            setIsRetryable(true);
            break;
        }
      } else {
        setErrorMessage(
          'Unable to connect to the AI assistant due to a network connection issue. Tap Retry to safely check and complete your request.'
        );
        setIsRetryable(true);
      }
    } finally {
      if (isMountedRef.current) {
        isGeneratingRef.current = false;
        setIsGenerating(false);
        onGeneratingChangeRef.current?.(false);
      }
    }
  };

  const handleRenewSession = async () => {
    if (!onRequestSessionRenew || isRenewingSession) return;
    setIsRenewingSession(true);
    try {
      const renewed = await onRequestSessionRenew();
      if (!isMountedRef.current) return;
      if (renewed) {
        setIsSessionExpired(false);
        setErrorMessage(null);
        setAuthoritativeQuota(null);
        pendingRequestRef.current = null;
      } else {
        setErrorMessage(
          'Unable to start a new review session. Please check your connection and try again.'
        );
      }
    } catch {
      if (!isMountedRef.current) return;
      setErrorMessage(
        'Unable to start a new review session. Please check your connection and try again.'
      );
    } finally {
      if (isMountedRef.current) {
        setIsRenewingSession(false);
      }
    }
  };

  /**
   * Action 2: "Post on Google"
   * A. Synchronously initiates clipboard write within the direct user interaction turn.
   * B. Synchronously attempts to reserve a new blank browser tab via direct user interaction.
   * C. Awaits the clipboard write operation.
   * D. If copy succeeds: navigates the reserved tab to validated Google Review URL.
   * E. If popup blocked: transitions button to direct native Google Review link (popup-blocker fallback).
   * F. If copy fails: closes reserved tab, does not navigate, and shows recoverable error.
   */
  const handlePostOnGoogle = async () => {
    const textToCopy = (editedDraftText || activeDraft?.backendDraftText || '').trim();
    if (!textToCopy) return;

    if (!googleReviewUrl || !isValidGoogleReviewUrl(googleReviewUrl)) {
      setPostState({
        status: 'invalid_url',
        message: 'A valid Google Review URL is not configured for this location.',
      });
      return;
    }

    // 1. Synchronously initiate clipboard write within the user activation turn BEFORE any popup or await
    const copyPromise = initiateClipboardWrite(textToCopy);

    // 2. Synchronously attempt to reserve a new blank browser tab within the same click turn
    const reservedTab = reserveExternalTab();

    // 3. Await the clipboard operation result
    let copied = false;
    try {
      copied = await copyPromise;
    } catch {
      copied = false;
    }

    // 4. Handle navigation or fallback
    if (copied) {
      if (reservedTab) {
        // Navigate the reserved tab to the validated business Google Review URL
        const navigated = navigateReservedTab(reservedTab, googleReviewUrl);
        if (navigated) {
          setPostState({ status: 'copied_and_opened' });
        } else {
          setPostState({ status: 'popup_blocked' });
        }
      } else {
        // Tab was blocked by browser. Change existing Post on Google control into direct link!
        setPostState({ status: 'popup_blocked' });
      }
    } else {
      // If clipboard copying fails: close reserved tab and DO NOT navigate
      closeReservedTab(reservedTab);
      setPostState({
        status: 'copy_failed',
        message:
          'Draft could not be automatically copied to clipboard. Please copy your draft above, then tap Continue to Google Reviews.',
      });
    }
  };

  // If feature is disabled by backend (503), gracefully render nothing
  if (isFeatureDisabled) {
    return null;
  }

  const isPolishDisabled =
    !isBrowserSupported || isGenerating || isQuotaExhausted || disabled || !hasMinimumText;

  return (
    <div
      data-testid="ai-draft-assistant"
      style={{
        marginTop: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Trigger Button & Quota Info */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <button
          type="button"
          data-testid="polish-draft-button"
          disabled={isPolishDisabled}
          onClick={() => handleGenerate(false)}
          className="touch-press"
          style={{
            minHeight: '44px',
            padding: '10px 20px',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 600,
            border: isPolishDisabled ? '1px solid #E2ECEB' : '1.5px solid #61B9B5',
            backgroundColor: isPolishDisabled ? '#F6FAF9' : '#E7F3F1',
            color: isPolishDisabled ? '#707978' : (brandColor || '#006764'),
            cursor: isPolishDisabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: isPolishDisabled ? 'none' : '0 2px 6px rgba(0, 103, 100, 0.08)',
            transition: 'all 0.15s ease',
          }}
        >
          <span aria-hidden="true">&#10024;</span>
          <span>{isGenerating ? 'Polishing Draft...' : 'Polish with AI ✨'}</span>
        </button>

        {/* Quota Presentation: Soft pill badge */}
        <span
          data-testid="ai-quota-indicator"
          style={{
            fontSize: '12px',
            color: isQuotaExhausted ? '#B91C1C' : '#006764',
            fontWeight: 600,
            backgroundColor: isQuotaExhausted ? '#FEF2F2' : '#F0F7F6',
            border: isQuotaExhausted ? '1px solid #FECACA' : '1px solid #D1E5E3',
            padding: '5px 12px',
            borderRadius: '20px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {authoritativeQuota === null
            ? 'Up to 3 AI drafts per visit'
            : isQuotaExhausted
            ? 'Draft limit reached (3/3 used)'
            : `${authoritativeQuota} draft${authoritativeQuota === 1 ? '' : 's'} remaining`}
        </span>
      </div>

      {/* Validation notice: At least 1 service required */}
      {serviceValidationError && (
        <div
          role="alert"
          data-testid="ai-service-validation-error"
          style={{
            padding: '12px 14px',
            backgroundColor: '#FEF2F2',
            borderRadius: '10px',
            border: '1px solid #FECACA',
            fontSize: '13px',
            color: '#B91C1C',
            fontWeight: 500,
          }}
        >
          {serviceValidationError}
        </div>
      )}

      {/* Helper text when browser does not support Intl.Segmenter */}
      {!isBrowserSupported && (
        <p
          data-testid="ai-unsupported-browser-hint"
          style={{ margin: 0, fontSize: '12px', color: '#707978' }}
        >
          AI review assistant is not supported in this browser. Please update your browser to use this feature.
        </p>
      )}

      {/* Helper text when input < 10 characters */}
      {isBrowserSupported && !hasMinimumText && (
        <p
          data-testid="ai-min-chars-hint"
          style={{ margin: 0, fontSize: '12px', color: '#707978' }}
        >
          Enter at least 10 characters to polish with AI.
        </p>
      )}

      {/* In-Flight Screen Reader / Visual Indicator */}
      {isGenerating && (
        <div
          role="status"
          aria-live="polite"
          data-testid="ai-generating-indicator"
          style={{
            padding: '14px 16px',
            backgroundColor: '#E7F3F1',
            borderRadius: '10px',
            border: '1px solid #A2D5D1',
            fontSize: '13px',
            color: '#006764',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              border: '2px solid #A2D5D1',
              borderTopColor: '#006764',
              animation: 'spin 1s linear infinite',
              display: 'inline-block',
            }}
            aria-hidden="true"
          />
          <span>Polishing your feedback into a review draft...</span>
        </div>
      )}

      {/* Insufficient Context Guidance */}
      {insufficientContextNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="ai-insufficient-context"
          style={{
            padding: '14px 16px',
            backgroundColor: '#FFFBEB',
            borderRadius: '10px',
            border: '1px solid #FDE68A',
            fontSize: '13px',
            color: '#92400E',
            lineHeight: 1.45,
          }}
        >
          {insufficientContextNotice}
        </div>
      )}

      {/* Error Message with Optional Retry or Session Renewal */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="ai-error-notice"
          style={{
            padding: '14px 16px',
            backgroundColor: '#FEF2F2',
            borderRadius: '10px',
            border: '1px solid #FECACA',
            fontSize: '13px',
            color: '#B91C1C',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <span>{errorMessage}</span>
          {isSessionExpired && onRequestSessionRenew && (
            <button
              type="button"
              data-testid="ai-renew-session-button"
              disabled={isRenewingSession}
              onClick={handleRenewSession}
              className="touch-press"
              style={{
                alignSelf: 'flex-start',
                minHeight: '36px',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isRenewingSession ? '#BDC9C7' : '#B91C1C',
                color: '#ffffff',
                border: 'none',
                cursor: isRenewingSession ? 'not-allowed' : 'pointer',
              }}
            >
              {isRenewingSession ? 'Starting session...' : 'Start a new review session'}
            </button>
          )}
          {isRetryable && (
            <button
              type="button"
              data-testid="ai-retry-button"
              disabled={isGenerating || isRateLimitedCooldown}
              onClick={() => handleGenerate(true)}
              className="touch-press"
              style={{
                alignSelf: 'flex-start',
                minHeight: '36px',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isGenerating || isRateLimitedCooldown ? '#BDC9C7' : '#B91C1C',
                color: '#ffffff',
                border: 'none',
                cursor: isGenerating || isRateLimitedCooldown ? 'not-allowed' : 'pointer',
              }}
            >
              {isRateLimitedCooldown ? 'Please wait a moment...' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {/* Active AI Draft Preview Card with Exactly TWO Actions: Regenerate & Post on Google */}
      {activeDraft && !isGenerating && (
        <div
          role="region"
          aria-label="AI Generated Review Draft"
          data-testid="ai-draft-card"
          style={{
            padding: '18px 20px',
            backgroundColor: '#F8FCFB',
            borderRadius: '14px',
            border: '1px solid #A2D5D1',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 2px 8px rgba(0, 103, 100, 0.05)',
          }}
        >
          {/* Card Header with Badges (Zero Edit Toggle Button) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#181C1C' }}>
                AI Suggested Review
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: '#E7F3F1',
                  color: '#006764',
                }}
              >
                Ready for Google
              </span>
            </div>
          </div>

          {/* Draft Content — Directly Editable */}
          <div>
            <textarea
              data-testid="ai-draft-text"
              value={editedDraftText}
              onChange={(e) => {
                const updated = e.target.value;
                setEditedDraftText(updated);
                onDraftChange?.(updated);
                if (postState.status !== 'idle') {
                  setPostState({ status: 'idle' });
                }
              }}
              aria-label="AI Generated Review Draft"
              rows={4}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1.5px solid #006764',
                fontSize: '15px',
                lineHeight: 1.5,
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                color: '#181C1C',
                backgroundColor: '#ffffff',
                resize: 'vertical',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                color: postState.status === 'copy_failed' ? '#92400E' : '#707978',
                marginTop: '3px',
                display: 'block',
                fontWeight: postState.status === 'copy_failed' ? 600 : 400,
              }}
            >
              {postState.status === 'copy_failed'
                ? 'Automatic copy failed. Please select and copy your review draft from the box above manually, then tap Continue to Google Reviews below.'
                : 'You can edit this suggested review directly before posting.'}
            </span>
          </div>

          {/* Copy Toast or Failure Alert */}
          {postState.status === 'copied_and_opened' && (
            <div
              role="status"
              aria-live="polite"
              data-testid="ai-post-copied-toast"
              style={{
                padding: '10px 14px',
                backgroundColor: '#DCFCE7',
                borderRadius: '10px',
                border: '1px solid #86EFAC',
                fontSize: '13px',
                color: '#166534',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span aria-hidden="true">&#10003;</span>
              <span>Draft copied! Google Reviews opened in a new tab. Paste your draft to publish.</span>
            </div>
          )}

          {postState.status === 'popup_blocked' && (
            <div
              role="status"
              aria-live="polite"
              data-testid="ai-post-copied-toast"
              style={{
                padding: '10px 14px',
                backgroundColor: '#DCFCE7',
                borderRadius: '10px',
                border: '1px solid #86EFAC',
                fontSize: '13px',
                color: '#166534',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span aria-hidden="true">&#10003;</span>
              <span>Draft copied to clipboard! Tap Continue to Google Reviews below to publish.</span>
            </div>
          )}

          {postState.status === 'copy_failed' && (
            <div
              role="alert"
              data-testid="ai-copy-failed-alert"
              style={{
                padding: '12px 14px',
                backgroundColor: '#FFFBEB',
                borderRadius: '10px',
                border: '1px solid #FDE68A',
                fontSize: '13px',
                color: '#92400E',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span>{postState.message}</span>
              <a
                href={googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="copy-failed-google-link"
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 16px',
                  backgroundColor: brandColor || '#006764',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Continue to Google Reviews &#8599;
              </a>
            </div>
          )}

          {postState.status === 'invalid_url' && (
            <div
              role="alert"
              data-testid="ai-error-notice"
              style={{
                padding: '12px 14px',
                backgroundColor: '#FEF2F2',
                borderRadius: '10px',
                border: '1px solid #FECACA',
                fontSize: '13px',
                color: '#B91C1C',
                fontWeight: 500,
              }}
            >
              {postState.message}
            </div>
          )}

          {/* THE EXACTLY TWO FINAL ACTION BUTTONS: Regenerate and Post on Google */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              alignItems: 'center',
              marginTop: '4px',
            }}
          >
            {/* Button 1: Regenerate */}
            <button
              type="button"
              data-testid="ai-regenerate-button"
              disabled={!hasMinimumText || isGenerating || isQuotaExhausted || disabled}
              onClick={() => handleGenerate(false)}
              className="touch-press"
              style={{
                flex: '1 1 120px',
                minHeight: '48px',
                padding: '12px 18px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                backgroundColor: '#ffffff',
                color: brandColor || '#006764',
                border: `1.5px solid ${brandColor || '#006764'}`,
                cursor: !hasMinimumText || isGenerating || isQuotaExhausted || disabled ? 'not-allowed' : 'pointer',
                opacity: !hasMinimumText || isGenerating || isQuotaExhausted || disabled ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                userSelect: 'none',
                boxSizing: 'border-box',
              }}
            >
              <span aria-hidden="true">&#128259;</span>
              <span>{isGenerating ? 'Regenerating...' : 'Regenerate'}</span>
            </button>

            {/* Button 2: Post on Google (transitions to direct link when popup is blocked) */}
            {postState.status === 'popup_blocked' ? (
              <a
                href={googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="post-to-google-button"
                className="touch-press"
                style={{
                  flex: '2 1 180px',
                  minHeight: '48px',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 700,
                  backgroundColor: brandColor || '#006764',
                  color: '#ffffff',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 103, 100, 0.2)',
                  userSelect: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <span>Continue to Google Reviews</span>
                <span aria-hidden="true">&#8599;</span>
              </a>
            ) : (
              <button
                type="button"
                data-testid="post-to-google-button"
                onClick={handlePostOnGoogle}
                className="touch-press"
                style={{
                  flex: '2 1 180px',
                  minHeight: '48px',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 700,
                  backgroundColor: brandColor || '#006764',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 103, 100, 0.2)',
                  userSelect: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <span>Post on Google</span>
                <span aria-hidden="true">&#8599;</span>
              </button>
            )}
          </div>

          {/* Microcopy explaining clipboard copy + Google publication */}
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#707978', textAlign: 'center' }}>
            {postState.status === 'copy_failed'
              ? 'Please copy your draft from the box above before continuing to Google.'
              : 'Your review draft will be copied to your clipboard. Simply paste it into Google to publish!'}
          </p>
        </div>
      )}
    </div>
  );
}
