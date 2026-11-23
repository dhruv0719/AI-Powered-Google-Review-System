import { useState, useRef } from 'react';
import { ErrorCodes } from '@review-system/shared';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { getContrastingTextColor } from '../utils/contrast.js';

export interface ServiceItem {
  id: string;
  name: string;
}

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
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [consentGiven, setConsentGiven] = useState(false); // MUST be false by default
  const [sessionInitiated, setSessionInitiated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-flight session creation promise ref to prevent duplicate/racing session requests
  const sessionPromiseRef = useRef<Promise<unknown> | null>(null);
  // Synchronous submission lock to prevent duplicate executions before React re-renders
  const isSubmittingRef = useRef(false);

  // Lazy session creation on first user interaction with concurrency deduplication
  const ensureSession = async (): Promise<boolean> => {
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

    const promise = publicApi.createPublicSession(code);
    sessionPromiseRef.current = promise;

    try {
      await promise;
      setSessionInitiated(true);
      return true;
    } catch {
      return false;
    } finally {
      sessionPromiseRef.current = null;
    }
  };

  const handleRatingClick = (stars: number) => {
    ensureSession();
    setRating(stars);
  };

  const toggleService = (serviceId: string) => {
    ensureSession();
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate submission or invalid submission via synchronous ref lock
    if (isSubmittingRef.current || submitting || !rating || rating < 1 || rating > 5 || !consentGiven) {
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      // Ensure customer session cookie is issued before submitting feedback
      if (!sessionInitiated) {
        const sessionSuccess = await ensureSession();
        if (!sessionSuccess) {
          setError('Unable to start feedback session. Please try again.');
          isSubmittingRef.current = false;
          setSubmitting(false);
          return;
        }
      }

      await publicApi.submitPublicFeedback(code, {
        rating,
        serviceIds: selectedServiceIds.filter((id) => typeof id === 'string'),
        feedbackText: feedbackText.trim() ? feedbackText.trim() : undefined,
        customerContact: customerContact.trim() ? customerContact.trim() : undefined,
        consentGiven: true,
      });

      setSubmitted(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      if (err instanceof PublicApiError) {
        switch (err.code) {
          case ErrorCodes.ALREADY_SUBMITTED:
            setError('Feedback has already been submitted for this session.');
            break;
          case ErrorCodes.INVALID_SESSION:
            setError('Your session has expired. Please select your rating again to refresh.');
            sessionPromiseRef.current = null;
            setSessionInitiated(false);
            break;
          case ErrorCodes.RATE_LIMITED:
            setError('Too many requests. Please wait a moment and try again.');
            break;
          case ErrorCodes.CAMPAIGN_INACTIVE:
            setError('This review campaign is currently inactive.');
            break;
          case ErrorCodes.TENANT_SUSPENDED:
            setError('This service is currently unavailable.');
            break;
          default:
            if (err.statusCode === 409) {
              setError('Feedback has already been submitted for this session.');
            } else if (err.statusCode === 401) {
              setError('Your session has expired. Please select your rating again to refresh.');
              sessionPromiseRef.current = null;
              setSessionInitiated(false);
            } else if (err.statusCode === 429) {
              setError('Too many requests. Please wait a moment and try again.');
            } else {
              setError('Unable to submit feedback. Please try again.');
            }
        }
      } else {
        setError('Unable to submit feedback. Please check your connection and try again.');
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
        style={{ textAlign: 'center', padding: '20px 8px' }}
        data-testid="feedback-success"
      >
        <div style={{ fontSize: '48px', color: '#16a34a', marginBottom: '12px' }} aria-hidden="true">
          &#10004;
        </div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827', fontWeight: 600 }}>
          Thank You for Your Feedback!
        </h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#4b5563', lineHeight: 1.5 }}>
          Your private feedback has been sent directly to the owner and management of{' '}
          <strong>{locationName}</strong>.
        </p>
        <div
          style={{
            padding: '16px',
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#1e40af',
          }}
        >
          Would you also like to share your experience publicly on Google?
          <br />
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '10px',
              minHeight: '44px',
              padding: '8px 16px',
              fontWeight: 600,
              color: brandColor || '#1d4ed8',
              textDecoration: 'underline',
            }}
          >
            Leave a Google Review &#8599;
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} data-testid="private-feedback-form">
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#111827', fontWeight: 600 }}>
          Send Private Feedback to Management
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#4b5563', lineHeight: 1.4 }}>
          Have compliments, suggestions, or concerns? Send a direct private note.
        </p>
      </div>

      {/* Star Rating with Native Accessible Radio Inputs */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
          How was your overall experience? <span style={{ color: '#dc2626' }} aria-hidden="true">*</span>
        </legend>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
          role="radiogroup"
          aria-label="How was your overall experience?"
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = (hoverRating !== null ? hoverRating : rating || 0) >= star;
            return (
              <label
                key={star}
                htmlFor={`rating-star-${star}`}
                data-testid={`star-label-${star}`}
                className="star-radio-item touch-press"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(null)}
                onClick={(e) => {
                  // If the user taps the label or star glyph directly, and this star is already selected,
                  // ensure session refresh is triggered (since native radio change won't fire)
                  if ((e.target as HTMLElement).tagName !== 'INPUT' && rating === star) {
                    handleRatingClick(star);
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '48px',
                  height: '48px', // WCAG 2.5.5 touch target >= 44x44px (48px thumb standard)
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRadius: '8px',
                }}
              >
                <input
                  type="radio"
                  id={`rating-star-${star}`}
                  name="rating"
                  value={star}
                  checked={rating === star}
                  onChange={() => handleRatingClick(star)}
                  onClick={() => {
                    // Re-clicking the already selected star must also refresh session if needed
                    if (rating === star) {
                      handleRatingClick(star);
                    }
                  }}
                  className="sr-only"
                  data-testid={`star-${star}`}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                />
                <span
                  style={{
                    fontSize: '32px',
                    lineHeight: 1,
                    color: isFilled ? '#eab308' : '#d1d5db',
                    transition: 'color 0.15s ease',
                  }}
                  aria-hidden="true"
                >
                  &#9733;
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Services Multi-Select Chips with >= 40px Touch Target */}
      {services.length > 0 && (
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            Which services did you experience? (Optional)
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {services.map((s) => {
              const isSelected = selectedServiceIds.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggleService(s.id)}
                  aria-pressed={isSelected}
                  className="touch-press"
                  style={{
                    minHeight: '40px', // Touch-friendly target height
                    padding: '8px 16px',
                    borderRadius: '9999px',
                    fontSize: '14px',
                    border: isSelected ? `2px solid ${brandColor}` : '1px solid #d1d5db',
                    backgroundColor: isSelected ? '#eff6ff' : '#fff',
                    color: isSelected ? brandColor : '#374151',
                    cursor: 'pointer',
                    fontWeight: isSelected ? 600 : 400,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                  }}
                >
                  {isSelected && <span style={{ marginRight: '4px' }} aria-hidden="true">&#10003;</span>}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Written Feedback Textarea - 16px font prevents iOS Safari auto-zoom */}
      <div>
        <label htmlFor="feedback-text" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
          Your Comments or Feedback (Optional)
        </label>
        <textarea
          id="feedback-text"
          value={feedbackText}
          aria-describedby="feedback-text-counter"
          onChange={(e) => {
            ensureSession();
            setFeedbackText(e.target.value);
          }}
          placeholder="Share details about what went well or what we can do better..."
          rows={3}
          maxLength={1000}
          style={{
            width: '100%',
            padding: '12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '16px', // Prevents iOS Safari viewport auto-zoom
            lineHeight: 1.4,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />
        <div
          id="feedback-text-counter"
          aria-live="polite"
          style={{ textAlign: 'right', fontSize: '12px', color: '#4b5563', marginTop: '4px' }}
        >
          {feedbackText.length}/1000 characters
        </div>
      </div>

      {/* Customer Contact Input - 16px font and >= 44px height */}
      <div>
        <label htmlFor="customer-contact" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
          Email or Phone (Optional)
        </label>
        <input
          id="customer-contact"
          type="text"
          value={customerContact}
          onChange={(e) => {
            ensureSession();
            setCustomerContact(e.target.value);
          }}
          placeholder="If you'd like the manager to contact you back"
          maxLength={100}
          style={{
            width: '100%',
            minHeight: '44px', // WCAG 2.5.5 minimum height
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '16px', // Prevents iOS Safari viewport auto-zoom
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Explicit Affirmative Consent Checkbox Container with Tap Usability */}
      <div
        className="consent-container touch-press"
        onClick={(e) => {
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
          padding: '14px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          id="consentCheckbox"
          checked={consentGiven}
          onChange={(e) => {
            ensureSession();
            setConsentGiven(e.target.checked);
          }}
          style={{
            marginTop: '2px',
            width: '18px',
            height: '18px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        <label
          htmlFor="consentCheckbox"
          style={{ fontSize: '13px', color: '#374151', lineHeight: 1.45, cursor: 'pointer' }}
        >
          <strong>I agree</strong> to submit this private feedback directly to the business owner and acknowledge that submitted information will be reviewed by management.
        </label>
      </div>

      {error && (
        <div
          role="alert"
          style={{ fontSize: '14px', color: '#b91c1c', backgroundColor: '#fef2f2', padding: '10px 14px', borderRadius: '6px' }}
        >
          {error}
        </div>
      )}

      {/* Submit Button with >= 48px Touch Target and High-Contrast Text */}
      <button
        type="submit"
        disabled={submitting || !rating || !consentGiven}
        className="touch-press"
        style={{
          minHeight: '48px', // Mobile touch target
          padding: '14px 20px',
          backgroundColor: !rating || !consentGiven ? '#9ca3af' : brandColor,
          color: !rating || !consentGiven ? '#ffffff' : submitButtonTextColor,
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 600,
          cursor: !rating || !consentGiven ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {submitting ? 'Submitting Feedback...' : 'Submit Private Feedback'}
      </button>
    </form>
  );
}
