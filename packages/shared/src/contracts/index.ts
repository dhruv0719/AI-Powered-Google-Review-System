import type { Role, TenantStatus, CampaignStatus, FeedbackStatus } from '../constants/index.js';

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

export interface CampaignDTO {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  code: string;
  publicUrl: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicServiceItemDTO {
  id: string;
  name: string;
}

export interface PublicQRResolutionDTO {
  tenant: {
    displayName: string;
    brandColor: string;
  };
  location: {
    name: string;
    address: string | null;
    city: string | null;
    googleReviewUrl: string;
  };
  services: PublicServiceItemDTO[];
  features?: {
    aiAssistantEnabled: boolean;
  };
}

export interface PublicSessionResponseDTO {
  expiresAt: string;
}

export interface FeedbackServiceItemDTO {
  serviceId: string;
  name: string;
}

export interface PrivateFeedbackDTO {
  id: string;
  tenantId: string;
  locationId: string;
  campaignId: string;
  rating: number;
  feedbackText: string | null;
  customerContact: string | null;
  consentGiven: boolean;
  consentAt: string;
  consentVersion: string;
  status: FeedbackStatus;
  services: FeedbackServiceItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackListResponseDTO {
  feedback: PrivateFeedbackDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export type {
  DraftGenerationRequestInput,
  DraftGenerationResponseDTO,
  DraftGenerationStatusType,
} from '../schemas/ai.schema.js';

