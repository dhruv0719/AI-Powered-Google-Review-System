import { useState } from 'react';
import { publicApi } from '../services/publicApi.js';

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

  // Lazy session creation on first user interaction
  const ensureSession = async () => {
    if (sessionInitiated) return;
    try {
      await publicApi.createPublicSession(code);
      setSessionInitiated(true);
    } catch {
      // Ignored here; will be re-attempted on submit
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
    if (!rating || !consentGiven) return;

    try {
      setSubmitting(true);
      setError(null);

      // Ensure explicit session cookie is issued
      if (!sessionInitiated) {
        await publicApi.createPublicSession(code);
        setSessionInitiated(true);
      }

      await publicApi.submitPublicFeedback(code, {
        rating,
        serviceIds: selectedServiceIds,
        feedbackText: feedbackText.trim() ? feedbackText.trim() : undefined,
        customerContact: customerContact.trim() ? customerContact.trim() : undefined,
        consentGiven: true,
      });

      setSubmitted(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '16px 0' }} data-testid="feedback-success">
        <div style={{ fontSize: '48px', color: '#16a34a', marginBottom: '12px' }}>
          &#10004;
        </div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827' }}>
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
            style={{
              display: 'inline-block',
              marginTop: '8px',
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }} data-testid="private-feedback-form">
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#111827' }}>
          Send Private Feedback to Management
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
          Have compliments, suggestions, or concerns? Send a direct private note.
        </p>
      </div>

      {/* Star Rating */}
      <div>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
          How was your overall experience? <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: '8px', cursor: 'pointer' }} role="group" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = (hoverRating !== null ? hoverRating : rating || 0) >= star;
            return (
              <span
                key={star}
                data-testid={`star-${star}`}
                role="button"
                tabIndex={0}
                aria-label={`${star} star`}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(null)}
                onClick={() => handleRatingClick(star)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleRatingClick(star);
                  }
                }}
                style={{
                  fontSize: '32px',
                  color: isFilled ? '#eab308' : '#d1d5db',
                  transition: 'color 0.15s ease',
                  userSelect: 'none',
                }}
              >
                &#9733;
              </span>
            );
          })}
        </div>
      </div>

      {/* Services Multi-Select Chips */}
      {services.length > 0 && (
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
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
                  style={{
                    padding: '6px 12px',
                    borderRadius: '9999px',
                    fontSize: '13px',
                    border: isSelected ? `1px solid ${brandColor}` : '1px solid #d1d5db',
                    backgroundColor: isSelected ? '#eff6ff' : '#fff',
                    color: isSelected ? brandColor : '#374151',
                    cursor: 'pointer',
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {isSelected && '✓ '}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Written Feedback Textarea */}
      <div>
        <label htmlFor="feedback-text" style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
          Your Comments or Feedback (Optional)
        </label>
        <textarea
          id="feedback-text"
          value={feedbackText}
          onChange={(e) => {
            ensureSession();
            setFeedbackText(e.target.value);
          }}
          placeholder="Share details about what went well or what we can do better..."
          rows={3}
          maxLength={1000}
          style={{
            width: '100%',
            padding: '10px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ textAlign: 'right', fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
          {feedbackText.length}/1000 characters
        </div>
      </div>

      {/* Customer Contact Input */}
      <div>
        <label htmlFor="customer-contact" style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
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
            padding: '8px 10px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Explicit Affirmative Consent Checkbox (UNCHECKED BY DEFAULT) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '12px',
          backgroundColor: '#f9fafb',
          borderRadius: '6px',
          border: '1px solid #e5e7eb',
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
          style={{ marginTop: '3px', cursor: 'pointer' }}
        />
        <label
          htmlFor="consentCheckbox"
          style={{ fontSize: '13px', color: '#374151', lineHeight: 1.4, cursor: 'pointer' }}
        >
          <strong>I agree</strong> to submit this private feedback directly to the business owner and acknowledge that submitted information will be reviewed by management.
        </label>
      </div>

      {error && (
        <div
          role="alert"
          style={{ fontSize: '13px', color: '#dc2626', backgroundColor: '#fef2f2', padding: '8px 12px', borderRadius: '4px' }}
        >
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={submitting || !rating || !consentGiven}
        style={{
          padding: '12px 20px',
          backgroundColor: !rating || !consentGiven ? '#9ca3af' : brandColor,
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '15px',
          fontWeight: 600,
          cursor: !rating || !consentGiven ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
        }}
      >
        {submitting ? 'Submitting Feedback...' : 'Submit Private Feedback'}
      </button>
    </form>
  );
}
