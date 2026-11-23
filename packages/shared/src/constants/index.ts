export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
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

export const AuthConstants = {
  MIN_PASSWORD_LENGTH: 8,
  SESSION_TTL_DAYS: 7,
  COOKIE_NAME: 'review_session',
} as const;
