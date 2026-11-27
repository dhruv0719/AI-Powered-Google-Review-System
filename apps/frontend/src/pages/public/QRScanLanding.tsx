import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  PublicQRResolutionDTO,
  sanitizeBrandColor,
  isValidGoogleReviewUrl,
  ErrorCodes,
} from '@review-system/shared';
import { publicApi, PublicApiError } from '../../services/publicApi.js';
import { CustomerReviewFlow } from '../../components/CustomerReviewFlow.js';

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
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            padding: '36px 24px',
            textAlign: 'center',
            boxShadow: '0 10px 30px -5px rgba(0, 103, 100, 0.07), 0 4px 10px -2px rgba(0, 0, 0, 0.03)',
            border: '1px solid #E2ECEB',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              margin: '0 auto 16px auto',
              backgroundColor: '#E7F3F1',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
            }}
            aria-hidden="true"
          >
            &#9749;
          </div>
          <h1
            style={{
              margin: '0 0 8px 0',
              fontFamily: "'Radio Canada Big', sans-serif",
              fontSize: '22px',
              color: '#181C1C',
              fontWeight: 700,
            }}
          >
            Connecting to Review Portal
          </h1>
          <p style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#3E4948', lineHeight: 1.5 }}>
            Waking up server (~30s on first load)...
          </p>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 16px',
              backgroundColor: '#E7F3F1',
              borderRadius: '20px',
              fontSize: '13px',
              color: '#006764',
              fontWeight: 600,
              marginBottom: '24px',
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
                minWidth: '140px',
                padding: '10px 22px',
                backgroundColor: '#ffffff',
                color: '#006764',
                border: '1.5px solid #006764',
                borderRadius: '10px',
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
          width: '100%',
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          padding: '48px 24px',
          textAlign: 'center',
          boxShadow: '0 10px 30px -5px rgba(0, 103, 100, 0.07), 0 4px 10px -2px rgba(0, 0, 0, 0.03)',
          border: '1px solid #E2ECEB',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '3px solid #E7F3F1',
            borderTopColor: '#006764',
            animation: 'spin 1s linear infinite',
          }}
          aria-hidden="true"
        />
        <p style={{ margin: 0, color: '#3E4948', fontSize: '15px', fontWeight: 500 }}>
          Loading customer review page...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        role="alert"
        style={{
          width: '100%',
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          padding: '36px 24px',
          textAlign: 'center',
          boxShadow: '0 10px 30px -5px rgba(0, 103, 100, 0.07), 0 4px 10px -2px rgba(0, 0, 0, 0.03)',
          border: '1px solid #E2ECEB',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 16px auto',
            backgroundColor: '#FEF2F2',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            color: '#B91C1C',
          }}
          aria-hidden="true"
        >
          &#9888;
        </div>
        <h1
          style={{
            margin: '0 0 8px 0',
            fontFamily: "'Radio Canada Big', sans-serif",
            fontSize: '22px',
            color: '#181C1C',
            fontWeight: 700,
          }}
        >
          Review Page Unavailable
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: '#3E4948', lineHeight: 1.5 }}>
          {error || 'This review link is invalid, expired, or inactive.'}
        </p>

        <button
          type="button"
          data-testid="retry-button"
          className="touch-press"
          onClick={loadCampaign}
          disabled={loading}
          style={{
            marginTop: '24px',
            minHeight: '44px',
            minWidth: '140px',
            padding: '12px 24px',
            backgroundColor: '#006764',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0, 103, 100, 0.2)',
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Sanitize brandColor on frontend before applying to dynamic CSS
  const brandColor = sanitizeBrandColor(data.tenant.brandColor);
  const locationAddress = [data.location.address, data.location.city].filter(Boolean).join(', ');

  return (
    <div
      style={{
        width: '100%',
        backgroundColor: '#ffffff',
        borderRadius: '24px',
        padding: '28px 22px',
        boxShadow: '0 10px 30px -5px rgba(0, 103, 100, 0.07), 0 4px 10px -2px rgba(0, 0, 0, 0.03)',
        border: '1px solid #E2ECEB',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      {/* Business Branding Header */}
      <header
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Storefront Avatar Badge */}
        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            backgroundColor: '#E7F3F1',
            border: '2px solid #D1E5E3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '14px',
            boxShadow: '0 2px 6px rgba(0, 103, 100, 0.08)',
          }}
          aria-hidden="true"
        >
          <span style={{ fontSize: '28px' }}>&#127978;</span>
        </div>

        <h1
          data-testid="business-name"
          style={{
            margin: '0 0 6px 0',
            fontFamily: "'Radio Canada Big', sans-serif",
            fontSize: '24px',
            color: '#181C1C',
            fontWeight: 700,
            lineHeight: 1.25,
            wordBreak: 'break-word',
            letterSpacing: '-0.01em',
          }}
        >
          {data.tenant.displayName}
        </h1>

        <p
          data-testid="location-name"
          style={{
            margin: '0 0 4px 0',
            fontSize: '15px',
            color: brandColor || '#006764',
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
              color: '#3E4948',
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '12px' }}>&#128205;</span>
            <span>{locationAddress}</span>
          </p>
        )}
      </header>

      {/* Unified Customer Review Flow */}
      <CustomerReviewFlow
        code={code}
        tenant={data.tenant}
        location={data.location}
        services={data.services}
        brandColor={brandColor}
      />
    </div>
  );
}
