import { useState, useRef, useEffect } from 'react';
import { publicApi } from '../services/publicApi.js';
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

export interface CustomerReviewFlowProps {
  code: string;
  tenant?: {
    displayName: string;
    brandColor?: string;
  };
  location?: {
    name?: string;
    address?: string | null;
    city?: string | null;
    googleReviewUrl: string;
  };
  locationName?: string;
  googleReviewUrl?: string;
  services: ServiceItem[];
  brandColor?: string;
  onSuccess?: () => void;
}

/**
 * CustomerReviewFlow presents a unified, mobile-first Google Review journey:
 * Rate (Emoji) -> Select Services (Compulsory) -> Describe Experience -> Polish with AI -> Regenerate or Post on Google.
 */
export function CustomerReviewFlow({
  code,
  location,
  locationName: _locationName,
  googleReviewUrl,
  services,
  brandColor = '#006764',
}: CustomerReviewFlowProps) {
  const effectiveReviewUrl = location?.googleReviewUrl || googleReviewUrl || '';
  const [rating, setRating] = useState<number | null>(null);
  const [availableServices, setAvailableServices] = useState<ServiceItem[]>(services);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [sessionInitiated, setSessionInitiated] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [activeDraftText, setActiveDraftText] = useState<string | null>(null);

  useEffect(() => {
    setAvailableServices(services);
  }, [services]);

  // Session promise ref to prevent duplicate/concurrent session requests
  const sessionPromiseRef = useRef<Promise<unknown> | null>(null);
  const sessionFailedRef = useRef(false);

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

  const handleRatingClick = (val: number) => {
    sessionFailedRef.current = false;
    ensureSession();
    setRating(val);
  };

  const toggleService = (serviceId: string) => {
    sessionFailedRef.current = false;
    ensureSession();
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleRequestSessionRenew = async (): Promise<boolean> => {
    sessionPromiseRef.current = null;
    sessionFailedRef.current = false;
    setSessionInitiated(false);
    return ensureSession(true);
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
    sessionFailedRef.current = false;
    return ensureSession();
  };

  return (
    <div
      data-testid="customer-review-flow"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '22px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Section B: Clean, friendly heading */}
      <div>
        <h2
          data-testid="share-experience-heading"
          style={{
            margin: '0 0 6px 0',
            fontFamily: "'Radio Canada Big', sans-serif",
            fontSize: '20px',
            color: '#181C1C',
            fontWeight: 700,
          }}
        >
          Share your experience
        </h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#3E4948', lineHeight: 1.45 }}>
          Tell us about your experience.
        </p>
      </div>

      {/* Section C: Emoji-based experience rating (1 to 5) */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend
          style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: 600,
            color: '#181C1C',
            marginBottom: '10px',
          }}
        >
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
                  minHeight: '48px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRadius: '14px',
                  backgroundColor: isSelected ? '#E7F3F1' : '#F6FAF9',
                  border: isSelected ? `2px solid ${brandColor}` : '1px solid #E2ECEB',
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
                  checked={isSelected}
                  onChange={() => handleRatingClick(item.value)}
                  onClick={() => {
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
                    color: isSelected ? brandColor : '#3E4948',
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

      {/* Section D: Services selection — COMPULSORY */}
      {availableServices.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#181C1C',
              }}
            >
              Which services did you use? <span style={{ color: '#dc2626' }} aria-hidden="true">*</span>
            </label>
            <span style={{ fontSize: '12px', color: '#707978' }}>
              Select at least one
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: availableServices.length > 3 ? 'repeat(auto-fill, minmax(130px, 1fr))' : '1fr',
              gap: '8px',
            }}
          >
            {availableServices.map((s) => {
              const isSelected = selectedServiceIds.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggleService(s.id)}
                  aria-pressed={isSelected}
                  className="touch-press"
                  style={{
                    minHeight: '44px',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontSize: '14px',
                    border: isSelected ? `2px solid ${brandColor}` : '1px solid #BDC9C7',
                    backgroundColor: isSelected ? '#E7F3F1' : '#ffffff',
                    color: isSelected ? brandColor : '#3E4948',
                    cursor: 'pointer',
                    fontWeight: isSelected ? 700 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    userSelect: 'none',
                    transition: 'all 0.15s ease',
                    boxSizing: 'border-box',
                  }}
                >
                  {isSelected && (
                    <span style={{ marginRight: '6px', fontWeight: 700 }} aria-hidden="true">
                      &#10003;
                    </span>
                  )}
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Section E: Customer comment */}
      <div>
        <label
          htmlFor="feedback-text"
          style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: 600,
            color: '#181C1C',
            marginBottom: '4px',
          }}
        >
          Tell us more about your experience
        </label>
        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#707978' }}>
          Share a few words about what you liked or experienced.
        </p>

        <textarea
          id="feedback-text"
          value={feedbackText}
          aria-describedby="feedback-text-counter"
          onChange={(e) => {
            ensureSession();
            setFeedbackText(e.target.value);
          }}
          placeholder="Share details about what went well or what you experienced..."
          rows={3}
          maxLength={1000}
          style={{
            width: '100%',
            padding: '14px 16px',
            border: '1px solid #BDC9C7',
            borderRadius: '12px',
            fontSize: '16px', // 16px font prevents iOS Safari auto-zoom
            lineHeight: 1.45,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            color: '#181C1C',
            backgroundColor: '#ffffff',
          }}
        />
        <div
          id="feedback-text-counter"
          data-testid="feedback-text-counter"
          aria-live="polite"
          style={{ textAlign: 'right', fontSize: '12px', color: '#707978', marginTop: '6px' }}
        >
          {feedbackText.length}/1000 characters
        </div>

        {/* Sections F & G: AI Polishing, Draft Preview, and the TWO Final Buttons */}
        <AiDraftAssistant
          code={code}
          feedbackText={feedbackText}
          rating={rating}
          serviceIds={selectedServiceIds}
          googleReviewUrl={effectiveReviewUrl}
          brandColor={brandColor}
          disabled={isAiGenerating}
          onGeneratingChange={setIsAiGenerating}
          onRequestSessionRenew={handleRequestSessionRenew}
          onEnsureSession={handleEnsureSessionForAi}
          onDraftChange={setActiveDraftText}
        />
      </div>

      {/* Section H: Unconditional Google Review Action (when NO draft is active) */}
      {!activeDraftText && effectiveReviewUrl && (
        <div
          style={{
            marginTop: '4px',
            paddingTop: '16px',
            borderTop: '1px solid #E2ECEB',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#707978' }}>
            Prefer to review directly on Google without AI?
          </p>
          <a
            data-testid="google-review-cta"
            className="touch-press"
            href={effectiveReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              minHeight: '48px',
              padding: '12px 20px',
              backgroundColor: '#ffffff',
              color: brandColor,
              border: `1.5px solid ${brandColor}`,
              borderRadius: '12px',
              textDecoration: 'none',
              fontSize: '15px',
              fontWeight: 600,
              userSelect: 'none',
              boxSizing: 'border-box',
            }}
          >
            <span>Write a Review on Google</span>
            <span aria-hidden="true">&#8599;</span>
          </a>
        </div>
      )}
    </div>
  );
}
