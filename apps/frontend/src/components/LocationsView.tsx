import { useState, useEffect } from 'react';
import { LocationDTO } from '@review-system/shared';
import { api } from '../api.js';

interface LocationsViewProps {
  tenantId: string;
  onSelectLocationForServices: (location: LocationDTO) => void;
}

export function LocationsView({ tenantId, onSelectLocationForServices }: LocationsViewProps) {
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Deactivation modal state for primary location
  const [deactivatingPrimaryLoc, setDeactivatingPrimaryLoc] = useState<LocationDTO | null>(null);
  const [replacementPrimaryId, setReplacementPrimaryId] = useState<string>('');

  const fetchLocations = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getLocations(tenantId, statusFilter);
      setLocations(res.locations);
    } catch (err: any) {
      setError(err.message || 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, [tenantId, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      await api.createLocation(tenantId, {
        name: name.trim(),
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postalCode: postalCode.trim() || null,
        phone: phone.trim() || null,
        googleReviewUrl: googleReviewUrl.trim() || null,
        isPrimary,
      });

      // Reset
      setName('');
      setAddress('');
      setCity('');
      setState('');
      setPostalCode('');
      setPhone('');
      setGoogleReviewUrl('');
      setIsPrimary(false);
      setShowAddForm(false);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to create location');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMakePrimary = async (loc: LocationDTO) => {
    try {
      setError(null);
      await api.updateLocation(tenantId, loc.id, { isPrimary: true });
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to switch primary location');
    }
  };

  const handleDeactivateClick = (loc: LocationDTO) => {
    const activeLocs = locations.filter((l) => l.isActive);

    if (loc.isPrimary) {
      if (activeLocs.length <= 1) {
        setError('Cannot deactivate the sole active location. Add another active location first.');
        return;
      }
      // Require selecting a replacement primary location
      const otherActive = activeLocs.filter((l) => l.id !== loc.id);
      setReplacementPrimaryId(otherActive[0]?.id || '');
      setDeactivatingPrimaryLoc(loc);
      return;
    }

    // Direct deactivation for non-primary location
    executeDeactivate(loc.id);
  };

  const executeDeactivate = async (locationId: string, newPrimaryId?: string) => {
    try {
      setError(null);
      await api.updateLocation(tenantId, locationId, {
        isActive: false,
        newPrimaryLocationId: newPrimaryId,
      });
      setDeactivatingPrimaryLoc(null);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate location');
    }
  };

  const handleReactivate = async (loc: LocationDTO) => {
    try {
      setError(null);
      await api.updateLocation(tenantId, loc.id, { isActive: true });
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate location');
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Business Locations</h2>
          <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
            Manage physical branches, Google review URLs, and location service catalogues.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            padding: '8px 16px',
            backgroundColor: showAddForm ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {showAddForm ? 'Cancel' : '+ Add Location'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Add Location Form */}
      {showAddForm && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', marginBottom: '24px', backgroundColor: '#f9fafb' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Add Location</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>Location Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Main Workshop / Downtown Branch"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Address</label>
                <input
                  type="text"
                  placeholder="Street address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>City</label>
                <input
                  type="text"
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>State</label>
                <input
                  type="text"
                  placeholder="State"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Postal Code</label>
                <input
                  type="text"
                  placeholder="PIN"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Phone</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Google Review URL</label>
                <input
                  type="url"
                  placeholder="https://g.page/r/.../review or https://search.google.com/local/writereview?placeid=..."
                  value={googleReviewUrl}
                  onChange={(e) => setGoogleReviewUrl(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                />
                <span style={{ fontSize: '11px', color: '#6b7280' }}>
                  Must be a valid HTTPS Google Review link (g.page, search.google.com, maps.app.goo.gl).
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <input
                type="checkbox"
                id="isPrimaryCheck"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
              />
              <label htmlFor="isPrimaryCheck" style={{ fontSize: '13px', cursor: 'pointer' }}>
                Set as Primary Location (First location is automatically primary)
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                alignSelf: 'flex-start',
                padding: '8px 20px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                marginTop: '8px',
              }}
            >
              {submitting ? 'Saving Location...' : 'Save Location'}
            </button>
          </form>
        </div>
      )}

      {/* Deactivate Primary Location Modal */}
      {deactivatingPrimaryLoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', maxWidth: '450px', width: '100%' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#b91c1c' }}>Deactivate Primary Location</h3>
            <p style={{ fontSize: '14px', color: '#4b5563', margin: '0 0 16px 0' }}>
              <strong>{deactivatingPrimaryLoc.name}</strong> is currently your primary location. To deactivate it, you must designate another active location as your new primary location.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                Select New Primary Location *
              </label>
              <select
                value={replacementPrimaryId}
                onChange={(e) => setReplacementPrimaryId(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
              >
                {locations
                  .filter((l) => l.isActive && l.id !== deactivatingPrimaryLoc.id)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setDeactivatingPrimaryLoc(null)}
                style={{ padding: '6px 12px', border: '1px solid #d1d5db', backgroundColor: '#fff', borderRadius: '4px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => executeDeactivate(deactivatingPrimaryLoc.id, replacementPrimaryId)}
                style={{ padding: '6px 16px', backgroundColor: '#b91c1c', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
              >
                Confirm &amp; Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Locations ({locations.length})</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['all', 'active', 'inactive'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: statusFilter === filter ? '#2563eb' : '#fff',
                color: statusFilter === filter ? '#fff' : '#374151',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading locations...</p>
      ) : locations.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', border: '1px dashed #d1d5db', borderRadius: '8px', color: '#6b7280' }}>
          No locations configured. Click <strong>+ Add Location</strong> to create your first business location!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {locations.map((loc) => (
            <div
              key={loc.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px 20px',
                backgroundColor: loc.isActive ? '#fff' : '#f9fafb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                opacity: loc.isActive ? 1 : 0.75,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <h4 style={{ margin: 0, fontSize: '16px' }}>{loc.name}</h4>
                  {loc.isPrimary && (
                    <span style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '9999px', fontWeight: 600 }}>
                      PRIMARY
                    </span>
                  )}
                  {!loc.isActive && (
                    <span style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '9999px' }}>
                      DEACTIVATED
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '13px', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {(loc.address || loc.city || loc.state) && (
                    <span>
                      {[loc.address, loc.city, loc.state, loc.postalCode].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {loc.phone && <span>Phone: {loc.phone}</span>}
                  {loc.googleReviewUrl ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      Google Review Link:{' '}
                      <a
                        href={loc.googleReviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'underline' }}
                      >
                        Test Link &#8599;
                      </a>
                    </span>
                  ) : (
                    <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No Google review link configured</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <button
                  onClick={() => onSelectLocationForServices(loc)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  Manage Services &rarr;
                </button>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {loc.isActive && !loc.isPrimary && (
                    <button
                      onClick={() => handleMakePrimary(loc)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        border: '1px solid #d1d5db',
                        backgroundColor: '#fff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Make Primary
                    </button>
                  )}

                  {loc.isActive ? (
                    <button
                      onClick={() => handleDeactivateClick(loc)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(loc)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        backgroundColor: '#ecfdf5',
                        color: '#065f46',
                        border: '1px solid #a7f3d0',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
