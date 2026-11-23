import type { Role, TenantStatus } from '../constants/index.js';

export interface UserDTO {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface TenantDTO {
  id: string;
  slug: string;
  displayName: string;
  role: Role;
  status: TenantStatus;
  brandColor?: string | null;
  logoUrl?: string | null;
}

export interface AuthResponseDTO {
  user: UserDTO;
  activeTenant: TenantDTO;
  availableTenants: TenantDTO[];
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; issue: string }>;
    requestId?: string;
  };
}

export interface LocationDTO {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  googleReviewUrl: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  activeServiceCount?: number;
}

export interface ServiceDTO {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
