import { useState, useEffect } from 'react';
import { PublicQRResolutionDTO } from '@review-system/shared';
import { api } from '../api.js';

interface CustomerLandingProps {
  code: string;
}

export function CustomerLanding({ code }: CustomerLandingProps) {
  const [data, setData] = useState<PublicQRResolutionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Customer Interaction Form State
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [consentGiven, setConsentGiven] = useState(false); // MUST be false by default
  const [sessionInitiated, setSessionInitiated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 1. Initial Read-Only Load (ZERO session writes, ZERO database mutation)
  useEffect(() => {
    const loadCampaign = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.resolvePublicCampaign(code);
        setData(res);
      } catch (err: any) {
        setError(err.message || 'This review link is invalid, expired, or inactive.');
      } finally {
        setLoading(false);
      }
    };

    loadCampaign();
  }, [code]);

  // Lazy session creation on first user interaction
  const ensureSession = async () => {
    if (sessionInitiated) return;
    try {
      await api.createPublicSession(code);
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
        await api.createPublicSession(code);
        setSessionInitiated(true);
      }

      await api.submitPublicFeedback(code, {
        rating,
        serviceIds: selectedServiceIds,
        feedbackText: feedbackText.trim() ? feedbackText.trim() : undefined,
        customerContact: customerContact.trim() ? customerContact.trim() : undefined,
        consentGiven: true,
      });

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          color: '#6b7280',
          backgroundColor: '#f9fafb',
          padding: '20px',
        }}
      >
        Loading customer review page...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          backgroundColor: '#f9fafb',
          padding: '20px',
        }}
      >
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '32px 24px',
            textAlign: 'center',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#9888;</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827' }}>
            Review Page Unavailable
          </h2>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280', lineHeight: 1.5 }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '520px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Business Branding Header */}
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <h1 style={{ margin: '0 0 6px 0', fontSize: '22px', color: '#111827' }}>
            {data.tenant.displayName}
          </h1>
          <p style={{ margin: '0 0 4px 0', fontSize: '15px', color: '#4b5563', fontWeight: 500 }}>
            {data.location.name}
          </p>
          {(data.location.address || data.location.city) && (
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
              {[data.location.address, data.location.city].filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        {/* UNCONDITIONAL Google Review Action (ZERO review gating) */}
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            border: '2px solid #3b82f6',
          }}
        >
          <div style={{ display: 'inline-block', fontSize: '32px', marginBottom: '8px' }}>
            &#11088;
          </div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#111827' }}>
            Support Us on Google
          </h2>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#4b5563', lineHeight: 1.4 }}>
            Public Google reviews directly support our staff and help other customers find us!
          </p>
          <a
            href={data.location.googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              width: '100%',
              boxSizing: 'border-box',
              padding: '14px 20px',
              backgroundColor: '#1d4ed8',
              color: '#fff',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
              boxShadow: '0 2px 4px rgba(29, 78, 216, 0.3)',
            }}
          >
            Write a Review on Google &#8599;
          </a>
        </div>

        {/* Private Direct Customer Feedback Section */}
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: '48px', color: '#16a34a', marginBottom: '12px' }}>
                &#10004;
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827' }}>
                Thank You for Your Feedback!
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#4b5563', lineHeight: 1.5 }}>
                Your private feedback has been sent directly to the owner and management of{' '}
                <strong>{data.location.name}</strong>.
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
                  href={data.location.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '8px',
                    fontWeight: 600,
                    color: '#1d4ed8',
                    textDecoration: 'underline',
                  }}
                >
                  Leave a Google Review &#8599;
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
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
                <div style={{ display: 'flex', gap: '8px', cursor: 'pointer' }}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled = (hoverRating !== null ? hoverRating : rating || 0) >= star;
                    return (
                      <span
                        key={star}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(null)}
                        onClick={() => handleRatingClick(star)}
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
              {data.services.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
                    Which services did you experience? (Optional)
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {data.services.map((s) => {
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
                            border: isSelected ? '1px solid #2563eb' : '1px solid #d1d5db',
                            backgroundColor: isSelected ? '#eff6ff' : '#fff',
                            color: isSelected ? '#1d4ed8' : '#374151',
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
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
                  Your Comments or Feedback (Optional)
                </label>
                <textarea
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
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
                  Email or Phone (Optional)
                </label>
                <input
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
                <div style={{ fontSize: '13px', color: '#dc2626', backgroundColor: '#fef2f2', padding: '8px 12px', borderRadius: '4px' }}>
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || !rating || !consentGiven}
                style={{
                  padding: '12px 20px',
                  backgroundColor: !rating || !consentGiven ? '#9ca3af' : '#2563eb',
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
          )}
        </div>
      </div>
    </div>
  );
}
