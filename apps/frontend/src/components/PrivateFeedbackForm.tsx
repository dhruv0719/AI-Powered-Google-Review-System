import { useState, useRef, useEffect } from 'react';
import { ErrorCodes, CreatePrivateFeedbackInput } from '@review-system/shared';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { getContrastingTextColor } from '../utils/contrast.js';
import { AiDraftAssistant } from './AiDraftAssistant.js';

export interface ServiceItem {
  id: string;
  name: string;
}

export const EMOJI_RATINGS = [
  { value: 1, emoji: '😡', label: 'Very bad' },
  { value: 2, emoji: '🙁', label: 'Bad' },
  { value: 3, emoji: '😑', label: 'Okay' },
  { value: 4, emoji: '😊', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Excellent' },
] as const;

export interface PrivateFeedbackFormProps {
  code: string;
  locationName: string;
  googleReviewUrl: string;
  services: ServiceItem[];
  brandColor?: string;
  onSuccess?: () => void;
}

export function PrivateFeedbackForm({
  code,
  locationName,
  googleReviewUrl,
  services,
  brandColor = '#2563EB',
  onSuccess,
}: PrivateFeedbackFormProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [availableServices, setAvailableServices] = useState<ServiceItem[]>(services);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [consentGiven, setConsentGiven] = useState(false); // MUST be false by default
  const [sessionInitiated, setSessionInitiated] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [hasAppliedAiDraft, setHasAppliedAiDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<
    'idle' | 'in_flight' | 'uncertain' | 'session_expired' | 'rejected' | 'confirmed'
  >('idle');

  // Sync available services if parent services prop changes
  useEffect(() => {
    setAvailableServices(services);
  }, [services]);

  // In-flight session creation promise ref to prevent duplicate/racing session requests
  const sessionPromiseRef = useRef<Promise<unknown> | null>(null);
  const sessionFailedRef = useRef(false);
  // Synchronous submission lock to prevent duplicate executions before React re-renders
  const isSubmittingRef = useRef(false);
  // Tracks immutable snapshot of pending in-flight submission for server-verifiable idempotency
  const pendingSubmissionRef = useRef<{ id: string; payload: CreatePrivateFeedbackInput } | null>(null);

  // Form inputs are locked during in-flight submission and when outcome is uncertain
  const isFormLocked = submitting || submissionStatus === 'uncertain';

  // Lazy session creation on first user interaction with concurrency deduplication
  const ensureSession = async (forceRenew = false): Promise<boolean> => {
    if (sessionInitiated && !forceRenew) {
      return true;
    }

    if (sessionPromiseRef.current && !forceRenew) {
      try {
        await sessionPromiseRef.current;
        return true;
      } catch {
        return false;
      }
    }

    if (sessionFailedRef.current && !forceRenew) {
      return false;
    }

    const promise = publicApi.createPublicSession(code);
    sessionPromiseRef.current = promise;

    try {
      await promise;
      setSessionInitiated(true);
      sessionFailedRef.current = false;
      return true;
    } catch {
      sessionFailedRef.current = true;
      return false;
    } finally {
      sessionPromiseRef.current = null;
    }
  };

  const handleRatingClick = (stars: number) => {
    if (isFormLocked) return;
    sessionFailedRef.current = false;
    ensureSession();
    setRating(stars);
  };

  const toggleService = (serviceId: string) => {
    if (isFormLocked) return;
    sessionFailedRef.current = false;
    ensureSession();
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleApplyDraft = (draftText: string) => {
    setFeedbackText(draftText);
    setHasAppliedAiDraft(true);
  };

  const handleRevertDraft = (restoredText: string) => {
    setFeedbackText(restoredText);
    setHasAppliedAiDraft(false);
  };

  const handleRequestSessionRenew = async (): Promise<boolean> => {
    sessionPromiseRef.current = null;
    sessionFailedRef.current = false;
    setSessionInitiated(false);
    setError(null);
    const success = await ensureSession(true);
    if (success) {
      if (submissionStatus === 'session_expired') {
        setSubmissionStatus('idle');
        setError(null);
      }
      return true;
    }
    return false;
  };

  const handleEnsureSessionForAi = async (): Promise<boolean> => {
    if (sessionInitiated) {
      return true;
    }
    if (sessionPromiseRef.current) {
      try {
        await sessionPromiseRef.current;
        return true;
      } catch {
        return false;
      }
    }
    // An intentional AI polish action resets the failure circuit breaker and attempts a controlled recovery
    sessionFailedRef.current = false;
    return ensureSession();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate submission or invalid submission via synchronous ref lock
    if (isSubmittingRef.current || submitting || isAiGenerating || !rating || rating < 1 || rating > 5 || !consentGiven) {
      return;
    }

    // Client-side normalization and validation (only for fresh submissions)
    const trimmedText = feedbackText.trim();
    const trimmedContact = customerContact.trim();

    if (!pendingSubmissionRef.current && trimmedText.length > 0 && trimmedText.length < 3) {
      setError('Feedback comments must be at least 3 characters if provided.');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setSubmissionStatus('in_flight');
    setError(null);

    try {
      // Ensure customer session cookie is issued before submitting feedback
      if (!sessionInitiated) {
        const sessionSuccess = await ensureSession();
        if (!sessionSuccess) {
          setError('Unable to start feedback session. Please try again.');
          isSubmittingRef.current = false;
          setSubmitting(false);
          setSubmissionStatus('idle');
          return;
        }
      }

      // Check whether an unresolved/pending submission exists
      let payloadToSubmit: CreatePrivateFeedbackInput;
      if (pendingSubmissionRef.current) {
        // Send exact preserved payload snapshot, service IDs, and clientSubmissionId
        payloadToSubmit = pendingSubmissionRef.current.payload;
      } else {
        // Fresh logical submission: generate stable unique submission ID
        const subId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

        payloadToSubmit = {
          rating,
          serviceIds: selectedServiceIds.filter((id) => typeof id === 'string'),
          feedbackText: trimmedText ? trimmedText : undefined,
          customerContact: trimmedContact ? trimmedContact : undefined,
          consentGiven: true,
          clientSubmissionId: subId,
        };
        pendingSubmissionRef.current = { id: subId, payload: payloadToSubmit };
      }

      await publicApi.submitPublicFeedback(code, payloadToSubmit);

      // Submission confirmed
      pendingSubmissionRef.current = null;
      setSubmissionStatus('confirmed');
      setSubmitted(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      if (err instanceof PublicApiError) {
        switch (err.code) {
          case ErrorCodes.INVALID_SERVICES: {
            try {
              const freshRes = await publicApi.resolvePublicCampaign(code);
              if (freshRes && Array.isArray(freshRes.services)) {
                setAvailableServices(freshRes.services);
                const activeIds = new Set(freshRes.services.map((s) => s.id));
                setSelectedServiceIds((prev) => prev.filter((id) => activeIds.has(id)));
              }
            } catch {
              // Silently retain current services if resolution fails; prevents retry loop
            }
            setError('One or more selected services are no longer available. Available services have been refreshed; please review your selection and submit again.');
            pendingSubmissionRef.current = null;
            setSubmissionStatus('rejected');
            break;
          }
          case ErrorCodes.ALREADY_SUBMITTED:
            setError('Feedback has already been submitted for this session.');
            pendingSubmissionRef.current = null;
            setSubmissionStatus('rejected');
            break;
          case ErrorCodes.INVALID_SESSION:
            setError('Your session has expired. Please select your rating again to refresh.');
            sessionPromiseRef.current = null;
            setSessionInitiated(false);
            setSubmissionStatus('session_expired');
            break;
          case ErrorCodes.RATE_LIMITED:
            setError('Too many requests. Please wait a moment and try again.');
            pendingSubmissionRef.current = null;
            setSubmissionStatus('rejected');
            break;
          case ErrorCodes.CAMPAIGN_INACTIVE:
            setError('This review campaign is currently inactive.');
            pendingSubmissionRef.current = null;
            setSubmissionStatus('rejected');
            break;
          case ErrorCodes.TENANT_SUSPENDED:
            setError('This service is currently unavailable.');
            pendingSubmissionRef.current = null;
            setSubmissionStatus('rejected');
            break;
          default:
            if (err.statusCode === 409) {
              setError('Feedback has already been submitted for this session.');
              pendingSubmissionRef.current = null;
              setSubmissionStatus('rejected');
            } else if (err.statusCode === 401) {
              setError('Your session has expired. Please select your rating again to refresh.');
              sessionPromiseRef.current = null;
              setSessionInitiated(false);
              setSubmissionStatus('session_expired');
            } else if (err.statusCode === 429) {
              setError('Too many requests. Please wait a moment and try again.');
              pendingSubmissionRef.current = null;
              setSubmissionStatus('rejected');
            } else {
              setError(err.message || 'Unable to submit feedback. Please try again.');
              pendingSubmissionRef.current = null;
              setSubmissionStatus('rejected');
            }
        }
      } else {
        // Ambiguous network failure or timeout: retain pending snapshot and lock form controls
        setSubmissionStatus('uncertain');
        setError('We could not confirm if your feedback reached management due to a network connection issue. Your feedback may have already been received. Tap Retry Submission to safely check and complete your submission without creating duplicates.');
      }
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const submitButtonTextColor = getContrastingTextColor(brandColor);

  if (submitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          textAlign: 'center',
          padding: '24px 12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
        data-testid="feedback-success"
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#E7F3F1',
            border: '2px solid #D1E5E3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            color: '#006764',
            marginBottom: '16px',
            boxShadow: '0 2px 8px rgba(0, 103, 100, 0.1)',
          }}
          aria-hidden="true"
        >
          &#10004;
        </div>
        <h3
          style={{
            margin: '0 0 8px 0',
            fontFamily: "'Radio Canada Big', sans-serif",
            fontSize: '22px',
            color: '#181C1C',
            fontWeight: 700,
          }}
        >
          Thank You for Your Feedback!
        </h3>
        <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#3E4948', lineHeight: 1.5, maxWidth: '400px' }}>
          Your private feedback has been sent directly to the owner and management of{' '}
          <strong>{locationName}</strong>.
        </p>
        <div
          style={{
            width: '100%',
            padding: '20px',
            backgroundColor: '#F0F7F6',
            borderRadius: '14px',
            border: '1px solid #D1E5E3',
            fontSize: '14px',
            color: '#181C1C',
            boxSizing: 'border-box',
          }}
        >
          <p style={{ margin: '0 0 10px 0', color: '#3E4948' }}>
            Would you also like to share your experience publicly on Google?
          </p>
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              minHeight: '44px',
              padding: '10px 20px',
              fontWeight: 600,
              fontSize: '15px',
              color: brandColor || '#006764',
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              border: `1.5px solid ${brandColor || '#006764'}`,
              textDecoration: 'none',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            }}
          >
            <span>Leave a Google Review</span>
            <span aria-hidden="true">&#8599;</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}
      data-testid="private-feedback-form"
    >
      <div>
        <h3
          style={{
            margin: '0 0 6px 0',
            fontFamily: "'Radio Canada Big', sans-serif",
            fontSize: '19px',
            color: '#181C1C',
            fontWeight: 700,
          }}
        >
          Send Private Feedback to Management
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#3E4948', lineHeight: 1.45 }}>
          Have compliments, suggestions, or concerns? Send a direct private note. Your feedback is sent directly to management and will not be posted to Google.
        </p>
      </div>

      {/* Emoji Experience Rating with Native Accessible Radio Inputs */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#181C1C', marginBottom: '10px' }}>
          How was your overall experience? <span style={{ color: '#dc2626' }} aria-hidden="true">*</span>
        </legend>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'stretch',
            gap: 'clamp(4px, 1.5vw, 10px)',
            width: '100%',
          }}
          role="radiogroup"
          aria-label="How was your overall experience?"
        >
          {EMOJI_RATINGS.map((item) => {
            const isSelected = rating === item.value;
            return (
              <label
                key={item.value}
                htmlFor={`rating-emoji-${item.value}`}
                data-testid={`star-label-${item.value}`}
                className="emoji-radio-item star-radio-item touch-press"
                onClick={(e) => {
                  if (isFormLocked) return;
                  // If the user taps the label or emoji glyph directly, and this rating is already selected,
                  // ensure session refresh is triggered (since native radio change won't fire)
                  if ((e.target as HTMLElement).tagName !== 'INPUT' && rating === item.value) {
                    handleRatingClick(item.value);
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '10px 4px 8px 4px',
                  minHeight: '48px', // WCAG 2.5.5 touch target >= 44x44px (48px standard)
                  cursor: isFormLocked ? 'not-allowed' : 'pointer',
                  opacity: isFormLocked ? 0.7 : 1,
                  userSelect: 'none',
                  borderRadius: '14px',
                  backgroundColor: isSelected ? '#E7F3F1' : '#F6FAF9',
                  border: isSelected ? `2px solid ${brandColor || '#006764'}` : '1px solid #E2ECEB',
                  boxShadow: isSelected ? '0 4px 12px rgba(0, 103, 100, 0.16)' : 'none',
                  transform: isSelected ? 'scale(1.03)' : 'scale(1)',
                  transition: 'all 0.15s ease',
                  boxSizing: 'border-box',
                }}
              >
                <input
                  type="radio"
                  id={`rating-emoji-${item.value}`}
                  name="rating"
                  value={item.value}
                  disabled={isFormLocked}
                  checked={isSelected}
                  onChange={() => !isFormLocked && handleRatingClick(item.value)}
                  onClick={() => {
                    if (isFormLocked) return;
                    if (rating === item.value) {
                      handleRatingClick(item.value);
                    }
                  }}
                  className="sr-only"
                  data-testid={`star-${item.value}`}
                  aria-label={`${item.value} - ${item.label}`}
                />
                <span
                  style={{
                    fontSize: 'clamp(32px, 8.5vw, 50px)',
                    lineHeight: 1.1,
                    display: 'block',
                    transform: isSelected ? 'scale(1.06)' : 'scale(1)',
                    transition: 'transform 0.15s ease',
                  }}
                  aria-hidden="true"
                >
                  {item.emoji}
                </span>
                <span
                  style={{
                    fontSize: 'clamp(10px, 2.2vw, 12px)',
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? (brandColor || '#006764') : '#3E4948',
                    marginTop: '4px',
                    textAlign: 'center',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {item.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Services Multi-Select Chips with >= 40px Touch Target */}
      {availableServices.length > 0 && (
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E4948', marginBottom: '8px' }}>
            Which services did you experience? (Optional)
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {availableServices.map((s) => {
              const isSelected = selectedServiceIds.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  disabled={isFormLocked}
                  onClick={() => !isFormLocked && toggleService(s.id)}
                  aria-pressed={isSelected}
                  className="touch-press"
                  style={{
                    minHeight: '40px', // Touch-friendly target height
                    padding: '8px 16px',
                    borderRadius: '9999px',
                    fontSize: '14px',
                    border: isSelected ? `2px solid ${brandColor || '#006764'}` : '1px solid #BDC9C7',
                    backgroundColor: isSelected ? '#E7F3F1' : '#ffffff',
                    color: isSelected ? (brandColor || '#006764') : '#3E4948',
                    cursor: isFormLocked ? 'not-allowed' : 'pointer',
                    opacity: isFormLocked ? 0.7 : 1,
                    fontWeight: isSelected ? 600 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSelected && <span style={{ marginRight: '6px', fontWeight: 700 }} aria-hidden="true">&#10003;</span>}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Written Feedback Textarea - 16px font prevents iOS Safari auto-zoom */}
      <div>
        <label htmlFor="feedback-text" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E4948', marginBottom: '6px' }}>
          Your Comments or Feedback (Optional)
        </label>
        <textarea
          id="feedback-text"
          value={feedbackText}
          disabled={isFormLocked}
          readOnly={isAiGenerating}
          aria-describedby="feedback-text-counter"
          onChange={(e) => {
            if (isFormLocked || isAiGenerating) return;
            ensureSession();
            setFeedbackText(e.target.value);
          }}
          placeholder="Share details about what went well or what we can do better..."
          rows={3}
          maxLength={1000}
          style={{
            width: '100%',
            padding: '14px 16px',
            border: '1px solid #BDC9C7',
            borderRadius: '12px',
            fontSize: '16px', // Prevents iOS Safari viewport auto-zoom
            lineHeight: 1.45,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            color: '#181C1C',
            backgroundColor: isFormLocked || isAiGenerating ? '#F6FAF9' : '#ffffff',
            cursor: isFormLocked ? 'not-allowed' : isAiGenerating ? 'default' : 'text',
          }}
        />
        <div
          id="feedback-text-counter"
          aria-live="polite"
          style={{ textAlign: 'right', fontSize: '12px', color: '#707978', marginTop: '6px' }}
        >
          {feedbackText.length}/1000 characters
        </div>

        {/* AI Draft Assistant embedded below textarea & counter */}
        <AiDraftAssistant
          code={code}
          feedbackText={feedbackText}
          rating={rating}
          serviceIds={selectedServiceIds}
          googleReviewUrl={googleReviewUrl}
          brandColor={brandColor}
          disabled={isFormLocked}
          onApplyDraft={handleApplyDraft}
          onRevertDraft={handleRevertDraft}
          hasAppliedDraft={hasAppliedAiDraft}
          onGeneratingChange={setIsAiGenerating}
          onRequestSessionRenew={handleRequestSessionRenew}
          onEnsureSession={handleEnsureSessionForAi}
        />
      </div>

      {/* Customer Contact Input - 16px font and >= 44px height */}
      <div>
        <label htmlFor="customer-contact" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E4948', marginBottom: '6px' }}>
          Email or Phone (Optional)
        </label>
        <input
          id="customer-contact"
          type="text"
          disabled={isFormLocked}
          value={customerContact}
          onChange={(e) => {
            if (isFormLocked) return;
            ensureSession();
            setCustomerContact(e.target.value);
          }}
          placeholder="If you'd like the manager to contact you back"
          maxLength={100}
          style={{
            width: '100%',
            minHeight: '44px', // WCAG 2.5.5 minimum height
            padding: '10px 16px',
            border: '1px solid #BDC9C7',
            borderRadius: '12px',
            fontSize: '16px', // Prevents iOS Safari viewport auto-zoom
            boxSizing: 'border-box',
            color: '#181C1C',
            backgroundColor: isFormLocked ? '#F6FAF9' : '#ffffff',
            cursor: isFormLocked ? 'not-allowed' : 'text',
          }}
        />
      </div>

      {/* Explicit Affirmative Consent Checkbox Container with Tap Usability */}
      <div
        className="consent-container touch-press"
        onClick={(e) => {
          if (isFormLocked) return;
          // If the click did not directly hit the input, toggle it
          if ((e.target as HTMLElement).tagName !== 'INPUT') {
            ensureSession();
            setConsentGiven(!consentGiven);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px',
          backgroundColor: '#F6FAF9',
          borderRadius: '12px',
          border: '1px solid #BDC9C7',
          cursor: isFormLocked ? 'not-allowed' : 'pointer',
          opacity: isFormLocked ? 0.7 : 1,
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          id="consentCheckbox"
          disabled={isFormLocked}
          checked={consentGiven}
          onChange={(e) => {
            if (isFormLocked) return;
            ensureSession();
            setConsentGiven(e.target.checked);
          }}
          style={{
            marginTop: '2px',
            width: '18px',
            height: '18px',
            cursor: isFormLocked ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            accentColor: brandColor || '#006764',
          }}
        />
        <label
          htmlFor="consentCheckbox"
          style={{ fontSize: '13px', color: '#3E4948', lineHeight: 1.45, cursor: isFormLocked ? 'not-allowed' : 'pointer' }}
        >
          <strong>I agree</strong> to submit this private feedback directly to the business owner and acknowledge that submitted information will be reviewed by management.
        </label>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            fontSize: '14px',
            color: '#B91C1C',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            padding: '12px 16px',
            borderRadius: '10px',
          }}
        >
          {error}
        </div>
      )}

      {/* Screen reader polite announcement during submission */}
      <div className="sr-only" aria-live="polite">
        {submitting ? 'Submitting your private feedback to management...' : ''}
      </div>

      {/* Submit Button with >= 48px Touch Target and High-Contrast Text */}
      <button
        type="submit"
        disabled={submitting || isAiGenerating || (!pendingSubmissionRef.current && (!rating || !consentGiven))}
        className="touch-press"
        style={{
          minHeight: '50px', // Mobile touch target
          padding: '14px 24px',
          backgroundColor:
            !rating || !consentGiven ? '#BDC9C7' : (brandColor || '#006764'),
          color:
            !rating || !consentGiven ? '#ffffff' : submitButtonTextColor,
          border: 'none',
          borderRadius: '12px',
          fontSize: '16px',
          fontWeight: 600,
          cursor:
            submitting || isAiGenerating || (!pendingSubmissionRef.current && (!rating || !consentGiven))
              ? 'not-allowed'
              : 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            !rating || !consentGiven ? 'none' : '0 4px 12px rgba(0, 103, 100, 0.2)',
        }}
      >
        {submitting
          ? 'Submitting Feedback...'
          : submissionStatus === 'uncertain'
          ? 'Retry Submission'
          : 'Submit Private Feedback'}
      </button>
    </form>
  );
}
