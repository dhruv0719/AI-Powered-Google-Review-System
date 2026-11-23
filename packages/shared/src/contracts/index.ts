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
