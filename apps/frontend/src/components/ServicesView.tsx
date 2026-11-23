import { useState, useEffect } from 'react';
import { LocationDTO, ServiceDTO } from '@review-system/shared';
import { api } from '../api.js';

interface ServicesViewProps {
  tenantId: string;
  location: LocationDTO;
  onBack: () => void;
}

export function ServicesView({ tenantId, location, onBack }: ServicesViewProps) {
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const fetchServices = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getServices(tenantId, location.id, statusFilter);
      setServices(res.services);
    } catch (err: any) {
      setError(err.message || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, [tenantId, location.id, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      await api.createService(tenantId, location.id, {
        name: name.trim(),
        description: description.trim() || null,
        displayOrder: parseInt(displayOrder, 10) || 0,
      });
      setName('');
      setDescription('');
      setDisplayOrder('0');
      fetchServices();
    } catch (err: any) {
      setError(err.message || 'Failed to add service');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (service: ServiceDTO) => {
    try {
      setError(null);
      await api.updateService(tenantId, location.id, service.id, {
        isActive: !service.isActive,
      });
      fetchServices();
    } catch (err: any) {
      setError(err.message || 'Failed to update service status');
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <button
            onClick={onBack}
            style={{
              padding: '6px 12px',
              backgroundColor: '#e5e7eb',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '8px',
            }}
          >
            &larr; Back to Locations
          </button>
          <h2 style={{ margin: 0 }}>Services for {location.name}</h2>
          <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
            Configure services offered at this physical location. These will appear as selection chips in the future review assistant.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Add Service Card */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '24px', backgroundColor: '#f9fafb' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Add New Service</h3>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px auto', gap: '8px', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>Service Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Oil Change"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>Description (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Synthetic oil & filter"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>Display Order</label>
            <input
              type="number"
              min="0"
              max="9999"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '8px 16px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Adding...' : 'Add Service'}
          </button>
        </form>
      </div>

      {/* Services List Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Service Catalogue ({services.length})</h3>
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
        <p style={{ color: '#6b7280' }}>Loading services...</p>
      ) : services.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed #d1d5db', borderRadius: '8px', color: '#6b7280' }}>
          No services configured for this location yet. Add your first service above!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {services.map((svc) => (
            <div
              key={svc.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                backgroundColor: svc.isActive ? '#fff' : '#f9fafb',
                opacity: svc.isActive ? 1 : 0.7,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600 }}>{svc.name}</span>
                  {!svc.isActive && (
                    <span style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px' }}>
                      Deactivated
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>Order: {svc.displayOrder}</span>
                </div>
                {svc.description && (
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#4b5563' }}>{svc.description}</p>
                )}
              </div>
              <button
                onClick={() => handleToggleActive(svc)}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  backgroundColor: svc.isActive ? '#fee2e2' : '#ecfdf5',
                  color: svc.isActive ? '#991b1b' : '#065f46',
                  border: `1px solid ${svc.isActive ? '#fca5a5' : '#a7f3d0'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {svc.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
