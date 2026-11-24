export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  LOCATION_NOT_FOUND: 'LOCATION_NOT_FOUND',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  CANNOT_DEACTIVATE_ONLY_LOCATION: 'CANNOT_DEACTIVATE_ONLY_LOCATION',
  CANNOT_UNSET_PRIMARY: 'CANNOT_UNSET_PRIMARY',
  INVALID_PRIMARY_REPLACEMENT: 'INVALID_PRIMARY_REPLACEMENT',
  CANNOT_PROMOTE_INACTIVE_LOCATION: 'CANNOT_PROMOTE_INACTIVE_LOCATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // M3 Additions
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GOOGLE_REVIEW_URL_REQUIRED: 'GOOGLE_REVIEW_URL_REQUIRED',
  CANNOT_REMOVE_GOOGLE_URL_ACTIVE_CAMPAIGN: 'CANNOT_REMOVE_GOOGLE_URL_ACTIVE_CAMPAIGN',
  INVALID_SERVICES: 'INVALID_SERVICES',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVALID_SESSION: 'INVALID_SESSION',
  RATE_LIMITED: 'RATE_LIMITED',
  // M6 AI Error Codes
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INPUT_NOT_MEANINGFUL: 'INPUT_NOT_MEANINGFUL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CONCURRENT_GENERATION_IN_PROGRESS: 'CONCURRENT_GENERATION_IN_PROGRESS',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH: 'IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH',
  OUTPUT_GUARDRAIL_FAILED: 'OUTPUT_GUARDRAIL_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const Roles = {
  OWNER: 'owner',
  MANAGER: 'manager',
  STAFF: 'staff',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export const TenantStatuses = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
} as const;

export type TenantStatus = (typeof TenantStatuses)[keyof typeof TenantStatuses];

export const SubscriptionStatuses = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatuses)[keyof typeof SubscriptionStatuses];

export const CampaignStatuses = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  REVOKED: 'revoked',
} as const;

export type CampaignStatus = (typeof CampaignStatuses)[keyof typeof CampaignStatuses];

export const FeedbackStatuses = {
  NEW: 'new',
  REVIEWED: 'reviewed',
  ARCHIVED: 'archived',
} as const;

export type FeedbackStatus = (typeof FeedbackStatuses)[keyof typeof FeedbackStatuses];

export const AuthConstants = {
  MIN_PASSWORD_LENGTH: 8,
  SESSION_TTL_DAYS: 7,
  COOKIE_NAME: 'review_session',
} as const;

export const CustomerSessionConstants = {
  COOKIE_NAME: 'customer_session',
  SESSION_TTL_MINUTES: 30,
  SESSION_TTL_MS: 30 * 60 * 1000,
  TOKEN_PREFIX: 'q_',
  TOKEN_LENGTH_BYTES: 16,
  TOKEN_REGEX: /^q_[A-Za-z0-9_-]{22}$/,
} as const;

export const AiAssistantConstants = {
  MAX_GENERATIONS_PER_SESSION: 3,
  LOCK_LEASE_DURATION_SECONDS: 30,
  MIN_FEEDBACK_LENGTH: 10,
  MAX_FEEDBACK_LENGTH: 500,
  DEFAULT_LANGUAGE: 'en',
} as const;

export const DEFAULT_BRAND_COLOR = '#2563EB';
export const BRAND_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export function isValidBrandColor(color: unknown): color is string {
  return typeof color === 'string' && BRAND_COLOR_REGEX.test(color);
}

export function sanitizeBrandColor(color: unknown): string {
  return isValidBrandColor(color) ? color : DEFAULT_BRAND_COLOR;
}
