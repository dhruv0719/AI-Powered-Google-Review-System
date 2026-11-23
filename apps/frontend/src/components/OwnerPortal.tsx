import { useState, useEffect } from 'react';
import { TenantDTO, UserDTO, LocationDTO } from '@review-system/shared';
import { api } from '../api.js';
import { LocationsView } from './LocationsView.js';
import { ServicesView } from './ServicesView.js';
import { CampaignsView } from './CampaignsView.js';
import { FeedbackInboxView } from './FeedbackInboxView.js';
import { ProfileView } from './ProfileView.js';

export function OwnerPortal() {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [activeTenant, setActiveTenant] = useState<TenantDTO | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantDTO[]>([]);
  const [activeTab, setActiveTab] = useState<'locations' | 'feedback' | 'profile'>('locations');
  const [selectedLocationForServices, setSelectedLocationForServices] = useState<LocationDTO | null>(null);
  const [selectedLocationForCampaigns, setSelectedLocationForCampaigns] = useState<LocationDTO | null>(null);
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getMe();
      setUser(res.user);
      setActiveTenant(res.activeTenant);
      setAvailableTenants(res.availableTenants);

      if (res.activeTenant) {
        const locRes = await api.getLocations(res.activeTenant.id);
        setLocations(locRes.locations);
      }
    } catch (err: any) {
      setError(err.message || 'Not authenticated. Please log in.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const handleSwitchTenant = async (tenantId: string) => {
    try {
      setLoading(true);
      setSelectedLocationForServices(null);
      setSelectedLocationForCampaigns(null);
      const res = await api.switchTenant(tenantId);
      setActiveTenant(res.activeTenant);
      await fetchSession();
    } catch (err: any) {
      setError(err.message || 'Failed to switch business tenant');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        data-testid="owner-loading"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
          color: '#6b7280',
        }}
      >
        Loading business dashboard...
      </div>
    );
  }

  if (!user || !activeTenant) {
    return (
      <div
        data-testid="owner-login-prompt"
        style={{
          maxWidth: '400px',
          margin: '100px auto',
          fontFamily: 'sans-serif',
          textAlign: 'center',
          padding: '24px',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
        }}
      >
        <h2 style={{ margin: '0 0 12px 0' }}>Review SaaS Portal</h2>
        <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>
          {error || 'Please authenticate via session cookie.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'sans-serif' }}>
      {/* Top Navigation Bar */}
      <header
        style={{
          backgroundColor: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1000px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#1e40af' }}>
              Google Review SaaS
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>Business:</span>
              <select
                value={activeTenant.id}
                onChange={(e) => handleSwitchTenant(e.target.value)}
                style={{
                  padding: '4px 8px',
                  fontSize: '13px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                }}
              >
                {availableTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName} ({t.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
            <span style={{ color: '#4b5563' }}>
              Logged in as: <strong>{user.fullName}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Main Tab Navigation */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div
          style={{
            maxWidth: '1000px',
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            gap: '24px',
          }}
        >
          <button
            onClick={() => {
              setSelectedLocationForServices(null);
              setSelectedLocationForCampaigns(null);
              setActiveTab('locations');
            }}
            style={{
              padding: '12px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'locations' && !selectedLocationForServices && !selectedLocationForCampaigns ? 600 : 400,
              color: activeTab === 'locations' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'locations' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Locations &amp; Review URLs
          </button>
          <button
            onClick={() => {
              setSelectedLocationForServices(null);
              setSelectedLocationForCampaigns(null);
              setActiveTab('feedback');
            }}
            style={{
              padding: '12px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'feedback' ? 600 : 400,
              color: activeTab === 'feedback' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'feedback' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Private Feedback
          </button>
          <button
            onClick={() => {
              setSelectedLocationForServices(null);
              setSelectedLocationForCampaigns(null);
              setActiveTab('profile');
            }}
            style={{
              padding: '12px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'profile' ? 600 : 400,
              color: activeTab === 'profile' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'profile' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Business Profile
          </button>
        </div>
      </div>

      {/* Main Content View */}
      <main style={{ maxWidth: '1000px', margin: '24px auto', padding: '0 24px' }}>
        {selectedLocationForServices ? (
          <ServicesView
            tenantId={activeTenant.id}
            location={selectedLocationForServices}
            onBack={() => setSelectedLocationForServices(null)}
          />
        ) : selectedLocationForCampaigns ? (
          <CampaignsView
            tenantId={activeTenant.id}
            location={selectedLocationForCampaigns}
            onBack={() => {
              setSelectedLocationForCampaigns(null);
              api.getLocations(activeTenant.id).then((res) => setLocations(res.locations));
            }}
          />
        ) : activeTab === 'locations' ? (
          <LocationsView
            tenantId={activeTenant.id}
            onSelectLocationForServices={(loc) => setSelectedLocationForServices(loc)}
            onSelectLocationForCampaigns={(loc) => setSelectedLocationForCampaigns(loc)}
          />
        ) : activeTab === 'feedback' ? (
          <FeedbackInboxView
            tenantId={activeTenant.id}
            locations={locations}
          />
        ) : (
          <ProfileView
            tenant={activeTenant}
            onTenantUpdated={(updated) => setActiveTenant(updated)}
          />
        )}
      </main>
    </div>
  );
}
