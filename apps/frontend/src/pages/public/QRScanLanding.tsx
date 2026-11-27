import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  PublicQRResolutionDTO,
  sanitizeBrandColor,
  isValidGoogleReviewUrl,
  ErrorCodes,
} from '@review-system/shared';
import { publicApi, PublicApiError } from '../../services/publicApi.js';
import { getContrastingTextColor } from '../../utils/contrast.js';
import { PrivateFeedbackForm } from '../../components/PrivateFeedbackForm.js';

export interface QRScanLandingProps {
  code?: string;
}

/**
 * Validates the public QR resolution DTO structure defensively.
 * Enforces non-empty strings and strictly validated Google Review URLs.
 */
function isResolutionDataValid(data: unknown): data is PublicQRResolutionDTO {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const candidate = data as Partial<PublicQRResolutionDTO>;
  if (
    !candidate.tenant ||
    typeof candidate.tenant.displayName !== 'string' ||
    !candidate.tenant.displayName.trim()
  ) {
    return false;
  }
  if (
    !candidate.location ||
    typeof candidate.location.name !== 'string' ||
    !candidate.location.name.trim()
  ) {
    return false;
  }
  if (
    !candidate.location.googleReviewUrl ||
    !isValidGoogleReviewUrl(candidate.location.googleReviewUrl)
  ) {
    return false;
  }
  return true;
}

/**
 * Maps API errors to customer-safe messages.
 * Never exposes raw backend errors, stack traces, or internal server details.
 */
function mapCustomerErrorMessage(err: unknown): string {
  if (err instanceof PublicApiError) {
    switch (err.code) {
      case ErrorCodes.CAMPAIGN_NOT_FOUND:
        return 'This review link is not found or has expired.';
      case ErrorCodes.CAMPAIGN_INACTIVE:
        return 'This review campaign is currently inactive.';
      case ErrorCodes.SERVICE_UNAVAILABLE:
        return 'This review service is currently unavailable.';
      case ErrorCodes.TENANT_SUSPENDED:
        return 'This review service is currently unavailable.';
      case ErrorCodes.RATE_LIMITED:
        return 'Too many requests. Please try again in a few minutes.';
      default:
        if (err.statusCode === 404) {
          return 'This review link is not found or has expired.';
        }
        if (err.statusCode === 403) {
          return 'This review service is currently unavailable.';
        }
        if (err.statusCode === 429) {
          return 'Too many requests. Please try again in a few minutes.';
        }
        return 'This review link is currently unavailable. Please try again later.';
    }
  }

  // Network drops, offline, aborts, or unexpected exceptions
  return 'Unable to load review page. Please check your connection and try again.';
}

export function QRScanLanding({ code: propCode }: QRScanLandingProps) {
  const params = useParams<{ code: string }>();
  const code = propCode || params.code || '';

  const [data, setData] = useState<PublicQRResolutionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coldStartState, setColdStartState] = useState<{
    isColdStart: boolean;
    attempt: number;
    maxAttempts: number;
  }>({
    isColdStart: false,
    attempt: 1,
    maxAttempts: 6,
  });

  // Guards against race conditions and overlapping requests
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadCampaign = useCallback(async () => {
    if (!code) {
      setLoading(false);
      setError('This review link is invalid, expired, or inactive.');
      return;
    }

    // Cancel any previous pending resolution attempt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setColdStartState({ isColdStart: false, attempt: 1, maxAttempts: 6 });

    try {
      const res = await publicApi.resolvePublicCampaign(code, {
        signal: abortController.signal,
        onProgress: (info) => {
          if (currentRequestId === requestIdRef.current) {
            setColdStartState({
              isColdStart: true,
              attempt: info.attempt,
              maxAttempts: info.maxAttempts,
            });
          }
        },
      });

      // Discard response if a newer request has started
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      // Defensive validation of the resolution response
      if (!isResolutionDataValid(res)) {
        setData(null);
        setError('This review link is invalid, expired, or inactive.');
      } else {
        setData(res);
        setError(null);
      }
    } catch (err: unknown) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setData(null);
      setError(mapCustomerErrorMessage(err));
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [code]);

  useEffect(() => {
    loadCampaign();

    return () => {
      // Invalidate any in-flight response and abort on unmount
      requestIdRef.current++;
      abortControllerRef.current?.abort();
    };
  }, [loadCampaign]);

  if (loading) {
    if (coldStartState.isColdStart) {
      return (
        <div
          role="status"
          aria-live="polite"
          data-testid="cold-start-progress"
          style={{
            width: '100%',
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '36px 24px',
            textAlign: 'center',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '14px' }} aria-hidden="true">&#9749;</div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827', fontWeight: 700 }}>
            Connecting to Review Portal
          </h1>
          <p style={{ margin: '0 0 14px 0', fontSize: '15px', color: '#4b5563', lineHeight: 1.5 }}>
            Waking up server (~30s on first load)...
          </p>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 14px',
              backgroundColor: '#f3f4f6',
              borderRadius: '20px',
              fontSize: '13px',
              color: '#4b5563',
              fontWeight: 500,
              marginBottom: '20px',
            }}
          >
            Attempt {coldStartState.attempt} of {coldStartState.maxAttempts} • Please keep page open
          </div>
          <div>
            <button
              type="button"
              data-testid="cold-start-retry-now"
              className="touch-press"
              onClick={loadCampaign}
              style={{
                minHeight: '44px',
                minWidth: '120px',
                padding: '10px 20px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry Connection Now
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          textAlign: 'center',
          padding: '40px 16px',
          color: '#4b5563',
          fontSize: '15px',
        }}
      >
        Loading customer review page...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        role="alert"
        style={{
          width: '100%',
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '32px 24px',
          textAlign: 'center',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: '40px', marginBottom: '12px' }} aria-hidden="true">&#9888;</div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827', fontWeight: 700 }}>
          Review Page Unavailable
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: '#4b5563', lineHeight: 1.5 }}>
          {error || 'This review link is invalid, expired, or inactive.'}
        </p>

        <button
          type="button"
          data-testid="retry-button"
          className="touch-press"
          onClick={loadCampaign}
          disabled={loading}
          style={{
            marginTop: '20px',
            minHeight: '44px',
            minWidth: '120px',
            padding: '12px 24px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Sanitize brandColor on frontend before applying to dynamic CSS
  const brandColor = sanitizeBrandColor(data.tenant.brandColor);
  // Ensure WCAG AA contrast (>= 4.5:1) for CTA button text across all merchant brand colors
  const ctaTextColor = getContrastingTextColor(brandColor);
  const locationAddress = [data.location.address, data.location.city].filter(Boolean).join(', ');

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* Business Branding Header */}
      <header
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '24px 20px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          borderTop: `4px solid ${brandColor}`,
        }}
      >
        <h1
          data-testid="business-name"
          style={{
            margin: '0 0 6px 0',
            fontSize: '22px',
            color: '#111827',
            fontWeight: 700,
            lineHeight: 1.25,
            wordBreak: 'break-word',
          }}
        >
          {data.tenant.displayName}
        </h1>
        <p
          data-testid="location-name"
          style={{
            margin: '0 0 4px 0',
            fontSize: '15px',
            color: '#374151',
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {data.location.name}
        </p>
        {locationAddress && (
          <p
            data-testid="location-address"
            style={{
              margin: 0,
              fontSize: '13px',
              color: '#4b5563', // WCAG AA compliant >= 4.5:1 contrast against #ffffff
              lineHeight: 1.4,
            }}
          >
            {locationAddress}
          </p>
        )}
      </header>

      {/* UNCONDITIONAL Google Review Action (ZERO review gating) */}
      <section
        aria-label="Google Review Action"
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '24px 20px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          border: `2px solid ${brandColor}`,
        }}
      >
        <div
          style={{ display: 'inline-block', fontSize: '32px', marginBottom: '8px' }}
          aria-hidden="true"
        >
          &#11088;
        </div>
        <h2
          style={{
            margin: '0 0 8px 0',
            fontSize: '18px',
            color: '#111827',
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          Support Us on Google
        </h2>
        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: '14px',
            color: '#4b5563',
            lineHeight: 1.45,
          }}
        >
          Public Google reviews directly support our staff and help other customers find us!
        </p>
        <a
          data-testid="google-review-cta"
          className="touch-press"
          href={data.location.googleReviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            minHeight: '48px', // WCAG 2.5.5 touch target >= 44x44px (48px thumb standard)
            padding: '14px 20px',
            backgroundColor: brandColor,
            color: ctaTextColor, // Mathematically calculated contrast >= 4.5:1
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '16px',
            fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.12)',
            userSelect: 'none',
          }}
        >
          Write a Review on Google &#8599;
        </a>
      </section>

      {/* 3. Direct Private Customer Feedback Section */}
      <section
        aria-label="Private Feedback to Management"
        data-testid="private-feedback-card"
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '24px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        <PrivateFeedbackForm
          code={code}
          locationName={data.location.name}
          googleReviewUrl={data.location.googleReviewUrl}
          services={data.services}
          brandColor={brandColor}
        />
      </section>
    </div>
  );
}
