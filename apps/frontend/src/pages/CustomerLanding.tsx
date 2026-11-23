import { useState, useEffect } from 'react';
import {
  PublicQRResolutionDTO,
  sanitizeBrandColor,
  isValidGoogleReviewUrl,
  ErrorCodes,
} from '@review-system/shared';
import { publicApi, PublicApiError } from '../services/publicApi.js';
import { PrivateFeedbackForm } from '../components/PrivateFeedbackForm.js';
import { getContrastingTextColor } from '../utils/contrast.js';

export interface CustomerLandingProps {
  code: string;
}

function isResolutionDataValid(data: unknown): data is PublicQRResolutionDTO {
  if (!data || typeof data !== 'object') return false;
  const c = data as Partial<PublicQRResolutionDTO>;
  return Boolean(
    c.tenant?.displayName?.trim() &&
    c.location?.name?.trim() &&
    c.location?.googleReviewUrl &&
    isValidGoogleReviewUrl(c.location.googleReviewUrl)
  );
}

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
        if (err.statusCode === 404) return 'This review link is not found or has expired.';
        if (err.statusCode === 403) return 'This review service is currently unavailable.';
        if (err.statusCode === 429) return 'Too many requests. Please try again in a few minutes.';
        return 'This review link is currently unavailable. Please try again later.';
    }
  }
  return 'Unable to load review page. Please check your connection and try again.';
}

/**
 * CustomerLanding is preserved for backward compatibility and M5 integration.
 * In M4, the primary public QR entrypoint is QRScanLanding (M4/M5 boundary).
 */
export function CustomerLanding({ code }: CustomerLandingProps) {
  const [data, setData] = useState<PublicQRResolutionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadCampaign = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await publicApi.resolvePublicCampaign(code);
        if (isMounted) {
          if (!isResolutionDataValid(res)) {
            setError('This review link is invalid, expired, or inactive.');
            setData(null);
          } else {
            setData(res);
          }
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setData(null);
        setError(mapCustomerErrorMessage(err));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadCampaign();
    return () => {
      isMounted = false;
    };
  }, [code]);

  if (loading) {
    return (
      <main
        role="status"
        aria-live="polite"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#4b5563',
          backgroundColor: '#f3f4f6',
          padding: '20px 16px',
        }}
      >
        Loading customer review page...
      </main>
    );
  }

  if (error || !data) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#f3f4f6',
          padding: '20px 16px',
        }}
      >
        <div
          role="alert"
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
          <div style={{ fontSize: '40px', marginBottom: '12px' }} aria-hidden="true">&#9888;</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827', fontWeight: 700 }}>
            Review Page Unavailable
          </h2>
          <p style={{ margin: 0, fontSize: '14px', color: '#4b5563', lineHeight: 1.5 }}>
            {error || 'This review link is invalid, expired, or inactive.'}
          </p>
        </div>
      </main>
    );
  }

  const brandColor = sanitizeBrandColor(data.tenant.brandColor);
  const ctaTextColor = getContrastingTextColor(brandColor);
  const locationAddress = [data.location.address, data.location.city].filter(Boolean).join(', ');

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '20px 12px',
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
          <h1 style={{ margin: '0 0 6px 0', fontSize: '22px', color: '#111827', fontWeight: 700 }}>
            {data.tenant.displayName}
          </h1>
          <p style={{ margin: '0 0 4px 0', fontSize: '15px', color: '#4b5563', fontWeight: 500 }}>
            {data.location.name}
          </p>
          {locationAddress && (
            <p style={{ margin: 0, fontSize: '13px', color: '#4b5563' }}>
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
          <div style={{ display: 'inline-block', fontSize: '32px', marginBottom: '8px' }} aria-hidden="true">
            &#11088;
          </div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#111827', fontWeight: 600 }}>
            Support Us on Google
          </h2>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#4b5563', lineHeight: 1.4 }}>
            Public Google reviews directly support our staff and help other customers find us!
          </p>
          <a
            href={data.location.googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-press"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              minHeight: '48px',
              padding: '14px 20px',
              backgroundColor: brandColor,
              color: ctaTextColor,
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)',
              userSelect: 'none',
            }}
          >
            Write a Review on Google &#8599;
          </a>
        </section>

        {/* Private Direct Customer Feedback Section (Preserved for M5) */}
        <div
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
        </div>
      </div>
    </main>
  );
}
