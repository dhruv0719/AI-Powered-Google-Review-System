import { useState, useRef, useEffect } from 'react';
import {
  DraftGenerationRequestInput,
  ErrorCodes,
} from '@review-system/shared';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { getContrastingTextColor } from '../utils/contrast.js';

export interface AiDraftAssistantProps {
  code: string;
  feedbackText: string;
  rating: number | null;
  serviceIds: string[];
  googleReviewUrl: string;
  brandColor?: string;
  disabled?: boolean;
  onApplyDraft: (draftText: string) => void;
  onRevertDraft: (restoredText: string) => void;
  hasAppliedDraft: boolean;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onRequestSessionRenew?: () => Promise<boolean>;
}

interface ActiveDraftState {
  clientDraftId: string;
  backendDraftText: string;
  generatedFeedback: string;
  generatedRating: number | null;
  generatedServiceIds: string[];
  appliedDraftText: string | null;
}

function areArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
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
  brandColor = '#2563EB',
  disabled = false,
  onApplyDraft,
  onRevertDraft,
  hasAppliedDraft,
  onGeneratingChange,
  onRequestSessionRenew,
}: AiDraftAssistantProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [authoritativeQuota, setAuthoritativeQuota] = useState<number | null>(null);
  const [activeDraft, setActiveDraft] = useState<ActiveDraftState | null>(null);
  const [preApplySnapshot, setPreApplySnapshot] = useState<string | null>(null);
  const [insufficientContextNotice, setInsufficientContextNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isRenewingSession, setIsRenewingSession] = useState(false);
  const [isRateLimitedCooldown, setIsRateLimitedCooldown] = useState(false);
  const [isFeatureDisabled, setIsFeatureDisabled] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [editedDraftText, setEditedDraftText] = useState('');

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

  // Stale detection
  const isDraftStale = (() => {
    if (!activeDraft) return false;
    // Check if rating or services changed
    if (rating !== activeDraft.generatedRating) return true;
    if (!areArraysEqual(serviceIds, activeDraft.generatedServiceIds)) return true;

    if (hasAppliedDraft) {
      // If draft was applied, text is only stale if customer modified the textarea after applying
      return feedbackText !== activeDraft.appliedDraftText;
    } else {
      // If draft was not applied, text is stale if textarea differs from the generation snapshot
      return feedbackText.trim() !== activeDraft.generatedFeedback.trim();
    }
  })();

  const currentDisplayDraft = isEditingDraft
    ? editedDraftText
    : (activeDraft?.backendDraftText ?? '');

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

    let payloadToSend: DraftGenerationRequestInput;

    if (isRetry) {
      if (!pendingRequestRef.current) return;
      payloadToSend = pendingRequestRef.current.payload;
    } else {
      if (!hasMinimumText || isQuotaExhausted) return;

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

    try {
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
        pendingRequestRef.current = null;
      } else {
        setInsufficientContextNotice(null);
        setActiveDraft({
          clientDraftId: payloadToSend.clientDraftId,
          backendDraftText: res.draft,
          generatedFeedback: feedbackText,
          generatedRating: rating,
          generatedServiceIds: [...serviceIds],
          appliedDraftText: null,
        });
        setEditedDraftText(res.draft);
        setIsEditingDraft(false);
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
              'Draft generation limit reached (3 of 3 used). You can still edit and submit your feedback.'
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
            // pendingRequestRef.current is preserved!
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
        // Network drops, connection resets, offline
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

  const handleApply = () => {
    if (!activeDraft) return;
    const textToApply = isEditingDraft ? editedDraftText : activeDraft.backendDraftText;

    // Pre-Apply Snapshot Rule: capture exact current textarea value before applying
    setPreApplySnapshot(feedbackText);

    // Update draft tracking to match applied text
    setActiveDraft((prev) => (prev ? { ...prev, appliedDraftText: textToApply } : null));

    onApplyDraft(textToApply);
  };

  const handleRevert = () => {
    if (preApplySnapshot !== null) {
      onRevertDraft(preApplySnapshot);
      setActiveDraft((prev) => (prev ? { ...prev, appliedDraftText: null } : null));
    }
  };

  const handleCopyDraft = async () => {
    if (!currentDisplayDraft) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentDisplayDraft);
        if (!isMountedRef.current) return;
        setCopiedToast(true);
        setTimeout(() => {
          if (isMountedRef.current) {
            setCopiedToast(false);
          }
        }, 3000);
      } else {
        if (!isMountedRef.current) return;
        setCopiedToast(true);
        setTimeout(() => {
          if (isMountedRef.current) {
            setCopiedToast(false);
          }
        }, 3000);
      }
    } catch {
      if (!isMountedRef.current) return;
      setCopiedToast(false);
      setErrorMessage('Could not copy automatically. Please select and copy the text manually.');
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
        setAuthoritativeQuota(null); // Fresh session has fresh quota
        pendingRequestRef.current = null; // Do NOT auto-retry failed draft
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

  const handleDiscard = () => {
    setActiveDraft(null);
    setIsEditingDraft(false);
    setErrorMessage(null);
    setIsSessionExpired(false);
    setInsufficientContextNotice(null);
    pendingRequestRef.current = null;
  };

  // If feature is disabled by backend (503), gracefully render nothing
  if (isFeatureDisabled) {
    return null;
  }

  const contrastColor = getContrastingTextColor(brandColor);

  return (
    <div
      data-testid="ai-draft-assistant"
      style={{
        marginTop: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* Action / Trigger Bar */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <button
          type="button"
          data-testid="polish-draft-button"
          disabled={!isBrowserSupported || !hasMinimumText || isGenerating || isQuotaExhausted || disabled}
          onClick={() => handleGenerate(false)}
          className="touch-press"
          style={{
            minHeight: '44px',
            padding: '10px 18px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            border: `1px solid ${brandColor}`,
            backgroundColor:
              !isBrowserSupported || !hasMinimumText || isGenerating || isQuotaExhausted || disabled
                ? '#f3f4f6'
                : brandColor,
            color:
              !isBrowserSupported || !hasMinimumText || isGenerating || isQuotaExhausted || disabled
                ? '#9ca3af'
                : contrastColor,
            cursor:
              !isBrowserSupported || !hasMinimumText || isGenerating || isQuotaExhausted || disabled
                ? 'not-allowed'
                : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'background-color 0.15s ease, opacity 0.15s ease',
          }}
        >
          <span aria-hidden="true">&#10024;</span>
          <span>{isGenerating ? 'Polishing Draft...' : 'Polish with AI'}</span>
        </button>

        {/* Quota Presentation: Neutral initially; Authoritative once known */}
        <span
          data-testid="ai-quota-indicator"
          style={{
            fontSize: '12px',
            color: isQuotaExhausted ? '#dc2626' : '#6b7280',
            fontWeight: isQuotaExhausted ? 600 : 400,
          }}
        >
          {authoritativeQuota === null
            ? 'Up to 3 AI drafts per visit'
            : isQuotaExhausted
            ? 'Draft limit reached (3/3 used)'
            : `${authoritativeQuota} draft${authoritativeQuota === 1 ? '' : 's'} remaining`}
        </span>
      </div>

      {/* Helper text when browser does not support Intl.Segmenter */}
      {!isBrowserSupported && (
        <p
          data-testid="ai-unsupported-browser-hint"
          style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}
        >
          AI review assistant is not supported in this browser. Please update your browser to use this feature.
        </p>
      )}

      {/* Helper text when input < 10 characters */}
      {isBrowserSupported && !hasMinimumText && graphemeCount !== null && graphemeCount > 0 && (
        <p
          data-testid="ai-min-chars-hint"
          style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}
        >
          Enter at least 10 characters to polish with AI.
        </p>
      )}

      {/* In-Flight Screen Reader Announcement */}
      {isGenerating && (
        <div
          role="status"
          aria-live="polite"
          data-testid="ai-generating-indicator"
          style={{
            padding: '12px',
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
            fontSize: '13px',
            color: '#1e40af',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span aria-hidden="true">&#9203;</span>
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
            padding: '12px',
            backgroundColor: '#fffbeb',
            borderRadius: '8px',
            border: '1px solid #fde68a',
            fontSize: '13px',
            color: '#92400e',
            lineHeight: 1.4,
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
            padding: '12px',
            backgroundColor: '#fef2f2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            fontSize: '13px',
            color: '#b91c1c',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
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
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isRenewingSession ? '#9ca3af' : '#b91c1c',
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
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isGenerating || isRateLimitedCooldown ? '#9ca3af' : '#b91c1c',
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

      {/* Active AI Draft Preview Card */}
      {activeDraft && !isGenerating && (
        <div
          role="region"
          aria-label="AI Generated Review Draft"
          data-testid="ai-draft-card"
          style={{
            padding: '16px',
            backgroundColor: '#f8fafc',
            borderRadius: '10px',
            border: isDraftStale ? '1px dashed #f59e0b' : '1px solid #cbd5e1',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Card Header & Badges */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                AI Suggested Draft
              </span>
              {hasAppliedDraft && (
                <span
                  data-testid="ai-applied-badge"
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    backgroundColor: '#dcfce7',
                    color: '#166534',
                  }}
                >
                  Applied
                </span>
              )}
            </div>

            {isDraftStale && (
              <span
                data-testid="ai-stale-badge"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                }}
              >
                Comments or selections changed
              </span>
            )}
          </div>

          {/* Draft Content (Read / Edit mode) */}
          {isEditingDraft ? (
            <textarea
              data-testid="ai-draft-edit-textarea"
              value={editedDraftText}
              onChange={(e) => setEditedDraftText(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #94a3b8',
                fontSize: '15px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <p
              data-testid="ai-draft-text"
              style={{
                margin: 0,
                fontSize: '15px',
                color: '#334155',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              {currentDisplayDraft}
            </p>
          )}

          {/* Stale Warning & Refresh Action */}
          {isDraftStale && (
            <div
              data-testid="ai-stale-notice"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: '#fffbeb',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#92400e',
                gap: '8px',
              }}
            >
              <span>Your feedback has changed since this draft was generated.</span>
              <button
                type="button"
                data-testid="ai-update-draft-button"
                disabled={!hasMinimumText || isGenerating || isQuotaExhausted || disabled}
                onClick={() => handleGenerate(false)}
                className="touch-press"
                style={{
                  minHeight: '32px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: '#d97706',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Update Draft
              </button>
            </div>
          )}

          {/* Action Row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              marginTop: '4px',
            }}
          >
            {/* 1. Independent Copy Draft Action */}
            <button
              type="button"
              data-testid="ai-copy-button"
              onClick={handleCopyDraft}
              className="touch-press"
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: copiedToast ? '#16a34a' : '#0f172a',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'background-color 0.15s ease',
              }}
            >
              <span aria-hidden="true">{copiedToast ? '&#10003;' : '&#128203;'}</span>
              <span>{copiedToast ? 'Copied to Clipboard!' : 'Copy Draft'}</span>
            </button>

            {/* 2. Independent Open Google Reviews Action */}
            <a
              href={googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="touch-press"
              data-testid="ai-open-google-button"
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: '#ffffff',
                color: brandColor,
                border: `1px solid ${brandColor}`,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                boxSizing: 'border-box',
              }}
            >
              <span>Open Google Reviews</span>
              <span aria-hidden="true">&#8599;</span>
            </a>

            {/* 3. Apply to Comments or Revert */}
            {hasAppliedDraft ? (
              <button
                type="button"
                data-testid="ai-revert-button"
                onClick={handleRevert}
                className="touch-press"
                style={{
                  minHeight: '44px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                  cursor: 'pointer',
                }}
              >
                Revert to Original
              </button>
            ) : (
              <button
                type="button"
                data-testid="ai-apply-button"
                onClick={handleApply}
                className="touch-press"
                style={{
                  minHeight: '44px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  color: '#1e40af',
                  border: '1px solid #93c5fd',
                  cursor: 'pointer',
                }}
              >
                Apply to Comments
              </button>
            )}

            {/* 4. Toggle Edit Mode */}
            <button
              type="button"
              data-testid="ai-edit-toggle-button"
              onClick={() => setIsEditingDraft(!isEditingDraft)}
              className="touch-press"
              style={{
                minHeight: '44px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#475569',
                backgroundColor: 'transparent',
                border: '1px solid #cbd5e1',
                cursor: 'pointer',
              }}
            >
              {isEditingDraft ? 'Done Editing' : 'Edit'}
            </button>

            {/* 5. Discard */}
            <button
              type="button"
              data-testid="ai-discard-button"
              onClick={handleDiscard}
              className="touch-press"
              style={{
                minHeight: '44px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#64748b',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              Discard
            </button>
          </div>

          {/* User Guidance Microcopy */}
          <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
            Tip: 1. Tap &quot;Copy Draft&quot; &bull; 2. Tap &quot;Open Google Reviews&quot; and paste your text into Google.
          </p>
        </div>
      )}
    </div>
  );
}
