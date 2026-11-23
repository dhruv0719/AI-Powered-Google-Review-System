import { useState, useEffect } from 'react';
import { CampaignDTO, LocationDTO } from '@review-system/shared';
import { api } from '../api.js';

interface CampaignsViewProps {
  tenantId: string;
  location: LocationDTO;
  onBack: () => void;
}

export function CampaignsView({ tenantId, location, onBack }: CampaignsViewProps) {
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // QR Preview Modal state
  const [previewCampaign, setPreviewCampaign] = useState<CampaignDTO | null>(null);

  // Action Confirmation Modal state
  const [actionCampaign, setActionCampaign] = useState<{
    campaign: CampaignDTO;
    type: 'rotate' | 'revoke';
  } | null>(null);

  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getCampaigns(tenantId, location.id);
      setCampaigns(res.campaigns);
    } catch (err: any) {
      setError(err.message || 'Failed to load QR campaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [tenantId, location.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      await api.createCampaign(tenantId, location.id, { name: campaignName.trim() });
      setCampaignName('');
      setShowAddForm(false);
      await fetchCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to create QR campaign');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (campaign: CampaignDTO) => {
    try {
      setError(null);
      const nextStatus = campaign.status === 'active' ? 'inactive' : 'active';
      await api.updateCampaign(tenantId, location.id, campaign.id, { status: nextStatus });
      await fetchCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to update campaign status');
    }
  };

  const handleConfirmAction = async () => {
    if (!actionCampaign) return;
    try {
      setError(null);
      if (actionCampaign.type === 'rotate') {
        await api.rotateCampaign(tenantId, location.id, actionCampaign.campaign.id);
      } else if (actionCampaign.type === 'revoke') {
        await api.revokeCampaign(tenantId, location.id, actionCampaign.campaign.id);
      }
      setActionCampaign(null);
      await fetchCampaigns();
    } catch (err: any) {
      setError(err.message || `Failed to ${actionCampaign.type} campaign`);
    }
  };

  const hasGoogleReviewUrl = Boolean(location.googleReviewUrl && location.googleReviewUrl.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            onClick={onBack}
            style={{
              padding: '4px 10px',
              backgroundColor: '#e5e7eb',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              marginBottom: '8px',
            }}
          >
            &larr; Back to Locations
          </button>
          <h3 style={{ margin: 0, fontSize: '20px' }}>QR Campaigns &mdash; {location.name}</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
            Generate and manage location-specific QR codes for physical display (table tents, counters, receipts).
          </p>
        </div>

        {hasGoogleReviewUrl && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {showAddForm ? 'Cancel' : '+ New QR Campaign'}
          </button>
        )}
      </div>

      {/* Prerequisite Alert if Google Review URL is missing */}
      {!hasGoogleReviewUrl && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            color: '#92400e',
            fontSize: '14px',
          }}
        >
          <strong>Google Review URL Required:</strong> Before generating QR codes for this location, you must configure its Google Review URL under Location settings.
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Add Campaign Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreate}
          style={{
            padding: '20px',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <h4 style={{ margin: 0, fontSize: '15px' }}>Create New QR Campaign</h4>
          <div>
            <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
              Campaign Name / Placement Description
            </label>
            <input
              type="text"
              placeholder="e.g. Front Reception Stand, Table 4 QR, Billing Counter"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              style={{
                padding: '6px 14px',
                backgroundColor: '#e5e7eb',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '6px 16px',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {submitting ? 'Generating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      )}

      {/* Campaigns List */}
      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading campaigns...</p>
      ) : campaigns.length === 0 ? (
        <div
          style={{
            padding: '36px',
            textAlign: 'center',
            border: '1px dashed #d1d5db',
            borderRadius: '8px',
            color: '#6b7280',
          }}
        >
          No QR campaigns yet for this location. Click <strong>+ New QR Campaign</strong> to generate one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {campaigns.map((c) => {
            const isRevoked = c.status === 'revoked';
            const isActive = c.status === 'active';

            return (
              <div
                key={c.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  backgroundColor: isRevoked ? '#f9fafb' : '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: isRevoked ? 0.7 : 1,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px' }}>{c.name}</h4>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontWeight: 600,
                        backgroundColor: isActive
                          ? '#dcfce7'
                          : isRevoked
                          ? '#fee2e2'
                          : '#fef3c7',
                        color: isActive ? '#15803d' : isRevoked ? '#991b1b' : '#b45309',
                      }}
                    >
                      {c.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: '13px', color: '#4b5563', display: 'flex', gap: '16px' }}>
                    <span>
                      Token: <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>{c.code}</code>
                    </span>
                    <span>
                      Public URL:{' '}
                      <a
                        href={c.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'underline' }}
                      >
                        {c.publicUrl} &#8599;
                      </a>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Download QR Button */}
                  {!isRevoked && (
                    <button
                      onClick={() => setPreviewCampaign(c)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 500,
                      }}
                    >
                      &#9638; Printable QR
                    </button>
                  )}

                  {/* Pause / Resume */}
                  {!isRevoked && (
                    <button
                      onClick={() => handleToggleStatus(c)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#fff',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      {isActive ? 'Pause' : 'Resume'}
                    </button>
                  )}

                  {/* Rotate Code */}
                  {!isRevoked && (
                    <button
                      onClick={() => setActionCampaign({ campaign: c, type: 'rotate' })}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#fff',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Rotate Code
                    </button>
                  )}

                  {/* Revoke */}
                  {!isRevoked && (
                    <button
                      onClick={() => setActionCampaign({ campaign: c, type: 'revoke' })}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QR Code Preview & Download Modal */}
      {previewCampaign && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '440px',
              width: '90%',
              textAlign: 'center',
            }}
          >
            <h4 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>
              Printable QR &mdash; {previewCampaign.name}
            </h4>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
              Scan to leave a Google Review or send private feedback to {location.name}.
            </p>

            {/* QR Image Preview */}
            <div
              style={{
                display: 'inline-block',
                padding: '16px',
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                marginBottom: '20px',
              }}
            >
              <img
                src={api.getCampaignQrPngUrl(tenantId, location.id, previewCampaign.id, 256)}
                alt="QR Code"
                width={200}
                height={200}
                style={{ display: 'block' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
              <a
                href={api.getCampaignQrSvgUrl(tenantId, location.id, previewCampaign.id)}
                download
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                Download SVG (Vector)
              </a>
              <a
                href={api.getCampaignQrPngUrl(tenantId, location.id, previewCampaign.id, 1024)}
                download
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                Download PNG (High-Res)
              </a>
            </div>

            <button
              onClick={() => setPreviewCampaign(null)}
              style={{
                padding: '6px 16px',
                backgroundColor: '#e5e7eb',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Rotate / Revoke */}
      {actionCampaign && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '460px',
              width: '90%',
            }}
          >
            <h4 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
              {actionCampaign.type === 'rotate' ? 'Rotate Campaign QR Code' : 'Revoke QR Campaign'}
            </h4>
            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.5, marginBottom: '20px' }}>
              {actionCampaign.type === 'rotate' ? (
                <>
                  Rotating this campaign will generate a brand new token and QR code for future printouts.
                  <strong> In-flight customer sessions already open will be preserved and permitted to complete their submission</strong>,
                  but any newly scanned old QR codes will be rejected.
                </>
              ) : (
                <>
                  Revoking this campaign is <strong>permanent and irreversible</strong>.
                  All scans and feedback submissions using this campaign will be immediately rejected.
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setActionCampaign(null)}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#e5e7eb',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                style={{
                  padding: '6px 16px',
                  backgroundColor: actionCampaign.type === 'revoke' ? '#dc2626' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {actionCampaign.type === 'rotate' ? 'Confirm Rotate' : 'Confirm Permanent Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
