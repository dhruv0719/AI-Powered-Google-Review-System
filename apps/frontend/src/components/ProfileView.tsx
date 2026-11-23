import { useState } from 'react';
import { TenantDTO } from '@review-system/shared';
import { api } from '../api.js';

interface ProfileViewProps {
  tenant: TenantDTO;
  onTenantUpdated: (updated: TenantDTO) => void;
}

export function ProfileView({ tenant, onTenantUpdated }: ProfileViewProps) {
  const [displayName, setDisplayName] = useState(tenant.displayName);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      const updated = await api.updateTenant(tenant.id, displayName.trim());
      onTenantUpdated(updated);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update business profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 8px 0' }}>Business Profile</h2>
      <p style={{ margin: '0 0 20px 0', color: '#6b7280', fontSize: '14px' }}>
        Update core business identification.
      </p>

      {error && (
        <div style={{ padding: '12px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: '12px', backgroundColor: '#ecfdf5', color: '#065f46', borderRadius: '4px', marginBottom: '16px' }}>
          Business display name updated successfully!
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', backgroundColor: '#fff' }}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
            Business Name *
          </label>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '16px', fontSize: '13px', color: '#6b7280' }}>
          <div><strong>Slug:</strong> {tenant.slug}</div>
          <div><strong>Role:</strong> {tenant.role}</div>
          <div><strong>Status:</strong> {tenant.status}</div>
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 20px',
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
