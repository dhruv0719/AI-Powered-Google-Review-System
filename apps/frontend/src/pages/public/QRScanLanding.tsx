import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PublicQRResolutionDTO, sanitizeBrandColor } from '@review-system/shared';
import { publicApi, PublicApiError } from '../../services/publicApi.js';

export interface QRScanLandingProps {
  code?: string;
}

export function QRScanLanding({ code: propCode }: QRScanLandingProps) {
  const params = useParams<{ code: string }>();
  const code = propCode || params.code || '';

  const [data, setData] = useState<PublicQRResolutionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError('Invalid review link: missing campaign code.');
      return;
    }

    let isMounted = true;

    const loadCampaign = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await publicApi.resolvePublicCampaign(code);
        if (isMounted) {
          setData(res);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        if (err instanceof PublicApiError) {
          if (err.statusCode === 404) {
            setError('This review link is not found or has expired.');
          } else if (err.statusCode === 403) {
            setError('This review campaign is currently inactive.');
          } else if (err.statusCode === 429) {
            setError('Too many requests. Please try again in a few minutes.');
          } else {
            setError(err.message || 'This review link is invalid, expired, or inactive.');
          }
        } else if (err instanceof Error) {
          setError(err.message || 'This review link is invalid, expired, or inactive.');
        } else {
          setError('This review link is invalid, expired, or inactive.');
        }
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
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#6b7280',
          backgroundColor: '#f9fafb',
          padding: '20px',
        }}
      >
        Loading customer review page...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#f9fafb',
          padding: '20px',
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
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#9888;</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#111827' }}>
            Review Page Unavailable
          </h2>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280', lineHeight: 1.5 }}>
            {error || 'This review link is invalid, expired, or inactive.'}
          </p>
        </div>
      </div>
    );
  }

  // Sanitize brandColor on frontend before applying to dynamic CSS
  const brandColor = sanitizeBrandColor(data.tenant.brandColor);
  const locationAddress = [data.location.address, data.location.city].filter(Boolean).join(', ');

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
        <header
          style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            borderTop: `4px solid ${brandColor}`,
          }}
        >
          <h1
            data-testid="business-name"
            style={{ margin: '0 0 6px 0', fontSize: '22px', color: '#111827' }}
          >
            {data.tenant.displayName}
          </h1>
          <p
            data-testid="location-name"
            style={{ margin: '0 0 4px 0', fontSize: '15px', color: '#4b5563', fontWeight: 500 }}
          >
            {data.location.name}
          </p>
          {locationAddress && (
            <p
              data-testid="location-address"
              style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}
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
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            border: `2px solid ${brandColor}`,
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
            data-testid="google-review-cta"
            href={data.location.googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              width: '100%',
              boxSizing: 'border-box',
              padding: '14px 20px',
              backgroundColor: brandColor,
              color: '#fff',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)',
            }}
          >
            Write a Review on Google &#8599;
          </a>
        </section>
      </div>
    </div>
  );
}
