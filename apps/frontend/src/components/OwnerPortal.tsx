import { useState, useEffect } from 'react';
import { TenantDTO, UserDTO, LocationDTO, AuthResponseDTO } from '@review-system/shared';
import { api } from '../api.js';
import { OwnerAuth } from './OwnerAuth.js';
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
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const fetchSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getMe();
      setUser(res.user);
      setActiveTenant(res.activeTenant);
      setAvailableTenants(res.availableTenants);

      if (res.activeTenant) {
        try {
          const locRes = await api.getLocations(res.activeTenant.id);
          setLocations(locRes.locations);
        } catch (locErr: any) {
          // Handled separately from authentication failure
          console.warn('[OwnerPortal] Location loading failure:', locErr);
        }
      }
    } catch (err: any) {
      setUser(null);
      setActiveTenant(null);
      setError(err.message || 'Not authenticated. Please log in.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const handleAuthSuccess = async (authData: AuthResponseDTO) => {
    setUser(authData.user);
    setActiveTenant(authData.activeTenant);
    setAvailableTenants(authData.availableTenants);
    setError(null);
    setLogoutError(null);

    if (authData.activeTenant) {
      try {
        const locRes = await api.getLocations(authData.activeTenant.id);
        setLocations(locRes.locations);
      } catch (locErr: any) {
        console.warn('[OwnerPortal] Initial location loading failure:', locErr);
      }
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      setLogoutError(null);
      await api.logout();
      // Server-side logout succeeded, session cookie cleared on server
      setUser(null);
      setActiveTenant(null);
      setAvailableTenants([]);
      setLocations([]);
      setSelectedLocationForServices(null);
      setSelectedLocationForCampaigns(null);
      setError(null);
    } catch (err: any) {
      // Mandatory requirement 5: Handle logout failures explicitly.
      // Do not claim the session is cleared if the server-side logout request fails.
      setLogoutError(err?.message || 'Failed to log out. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  };

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
    return <OwnerAuth onAuthSuccess={handleAuthSuccess} />;
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
            <button
              type="button"
              data-testid="owner-logout-button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="touch-press"
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#dc2626',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                cursor: isLoggingOut ? 'not-allowed' : 'pointer',
                minHeight: '36px',
              }}
            >
              {isLoggingOut ? 'Logging out...' : 'Log Out'}
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard general error banner */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="owner-dashboard-error"
          style={{
            maxWidth: '1000px',
            margin: '16px auto 0',
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Logout error banner */}
      {logoutError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="owner-logout-error"
          style={{
            maxWidth: '1000px',
            margin: '16px auto 0',
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        >
          {logoutError}
        </div>
      )}

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
