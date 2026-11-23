import {
  LocationDTO,
  ServiceDTO,
  TenantDTO,
  UserDTO,
  CampaignDTO,
  PrivateFeedbackDTO,
  FeedbackListResponseDTO,
  CreatePrivateFeedbackInput,
} from '@review-system/shared';
import { publicApi } from './services/publicApi.js';

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

  // QR Campaigns
  getCampaigns: (tenantId: string, locationId: string) =>
    request<{ campaigns: CampaignDTO[] }>(
      `/owner/tenants/${tenantId}/locations/${locationId}/campaigns`
    ),
  createCampaign: (tenantId: string, locationId: string, data: { name: string }) =>
    request<CampaignDTO>(`/owner/tenants/${tenantId}/locations/${locationId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCampaign: (
    tenantId: string,
    locationId: string,
    campaignId: string,
    data: { name?: string; status?: 'active' | 'inactive' }
  ) =>
    request<CampaignDTO>(
      `/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaignId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),
  rotateCampaign: (tenantId: string, locationId: string, campaignId: string) =>
    request<CampaignDTO>(
      `/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaignId}/rotate`,
      { method: 'POST' }
    ),
  revokeCampaign: (tenantId: string, locationId: string, campaignId: string) =>
    request<CampaignDTO>(
      `/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaignId}/revoke`,
      { method: 'POST' }
    ),
  getCampaignQrSvgUrl: (tenantId: string, locationId: string, campaignId: string) =>
    `${API_BASE}/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaignId}/qr.svg`,
  getCampaignQrPngUrl: (tenantId: string, locationId: string, campaignId: string, size = 512) =>
    `${API_BASE}/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaignId}/qr.png?size=${size}`,

  // Private Feedback Inbox
  getFeedback: (
    tenantId: string,
    params?: {
      locationId?: string;
      status?: 'new' | 'reviewed' | 'archived' | 'all';
      page?: number;
      limit?: number;
    }
  ) => {
    const q = new URLSearchParams();
    if (params?.locationId) q.set('locationId', params.locationId);
    if (params?.status) q.set('status', params.status);
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return request<FeedbackListResponseDTO>(`/owner/tenants/${tenantId}/feedback${qs}`);
  },
  updateFeedbackStatus: (
    tenantId: string,
    feedbackId: string,
    status: 'reviewed' | 'archived'
  ) =>
    request<PrivateFeedbackDTO>(`/owner/tenants/${tenantId}/feedback/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Public QR Journey (delegated to dedicated publicApi service)
  resolvePublicCampaign: (code: string) => publicApi.resolvePublicCampaign(code),
  createPublicSession: (code: string) => publicApi.createPublicSession(code),
  submitPublicFeedback: (code: string, data: CreatePrivateFeedbackInput) =>
    publicApi.submitPublicFeedback(code, data),
};
