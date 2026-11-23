import { LocationDTO, ServiceDTO, TenantDTO, UserDTO } from '@review-system/shared';

const API_BASE = '/api/v1';

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data?.error?.message || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg);
    (err as any).code = data?.error?.code;
    (err as any).details = data?.error?.details;
    throw err;
  }

  return data as T;
}

export const api = {
  // Auth & Tenant Context
  getMe: () => request<{ user: UserDTO; activeTenant: TenantDTO; availableTenants: TenantDTO[] }>('/auth/me'),
  switchTenant: (tenantId: string) =>
    request<{ activeTenant: TenantDTO }>(`/owner/tenants/${tenantId}/switch`, { method: 'POST' }),
  updateTenant: (tenantId: string, displayName: string) =>
    request<TenantDTO>(`/owner/tenants/${tenantId}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    }),

  // Locations
  getLocations: (tenantId: string, status: 'all' | 'active' | 'inactive' = 'all') =>
    request<{ locations: LocationDTO[] }>(`/owner/tenants/${tenantId}/locations?status=${status}`),
  createLocation: (
    tenantId: string,
    data: {
      name: string;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      phone?: string | null;
      googleReviewUrl?: string | null;
      isPrimary?: boolean;
    }
  ) =>
    request<LocationDTO>(`/owner/tenants/${tenantId}/locations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLocation: (
    tenantId: string,
    locationId: string,
    data: {
      name?: string;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      phone?: string | null;
      googleReviewUrl?: string | null;
      isPrimary?: boolean;
      isActive?: boolean;
      newPrimaryLocationId?: string;
    }
  ) =>
    request<LocationDTO>(`/owner/tenants/${tenantId}/locations/${locationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Services
  getServices: (tenantId: string, locationId: string, status: 'all' | 'active' | 'inactive' = 'all') =>
    request<{ services: ServiceDTO[] }>(
      `/owner/tenants/${tenantId}/locations/${locationId}/services?status=${status}`
    ),
  createService: (
    tenantId: string,
    locationId: string,
    data: { name: string; description?: string | null; displayOrder?: number }
  ) =>
    request<ServiceDTO>(`/owner/tenants/${tenantId}/locations/${locationId}/services`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateService: (
    tenantId: string,
    locationId: string,
    serviceId: string,
    data: { name?: string; description?: string | null; displayOrder?: number; isActive?: boolean }
  ) =>
    request<ServiceDTO>(`/owner/tenants/${tenantId}/locations/${locationId}/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
