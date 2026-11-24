import { sql, eq } from 'drizzle-orm';
import { AiAssistantConstants, ErrorCodes } from '@review-system/shared';
import {
  ephemeralSessions,
  ephemeralSessionDrafts,
  tenants,
  locations,
  qrCampaigns,
} from '../drizzle/schema.js';

// --- Error Classes ---

export class AiValidationError extends Error {
  public readonly code = ErrorCodes.VALIDATION_ERROR;
  public readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AiValidationError';
  }
}

export class FeatureDisabledError extends Error {
  public readonly code = ErrorCodes.FEATURE_DISABLED;
  public readonly status = 503;
  constructor(message = 'AI review assistant is currently disabled') {
    super(message);
    this.name = 'FeatureDisabledError';
  }
}

export class InvalidSessionError extends Error {
  public readonly code = ErrorCodes.INVALID_SESSION;
  public readonly status = 401;
  constructor(message = 'Session has expired or is invalid. Please refresh the page.') {
    super(message);
    this.name = 'InvalidSessionError';
  }
}

export class TenantSuspendedError extends Error {
  public readonly code = ErrorCodes.TENANT_SUSPENDED;
  public readonly status = 403;
  constructor(message = 'This business is currently unavailable.') {
    super(message);
    this.name = 'TenantSuspendedError';
  }
}

export class CampaignInactiveError extends Error {
  public readonly code = ErrorCodes.CAMPAIGN_INACTIVE;
  public readonly status = 400;
  constructor(message = 'This review campaign is currently inactive.') {
    super(message);
    this.name = 'CampaignInactiveError';
  }
}

export class GoogleReviewUrlRequiredError extends Error {
  public readonly code = ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED;
  public readonly status = 400;
  constructor(message = 'A valid Google Review URL must be configured for this location.') {
    super(message);
    this.name = 'GoogleReviewUrlRequiredError';
  }
}

export class QuotaExceededError extends Error {
  public readonly code = ErrorCodes.QUOTA_EXCEEDED;
  public readonly status = 429;
  constructor(message = 'Draft generation quota exceeded for this session') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class ConcurrentGenerationError extends Error {
  public readonly code = ErrorCodes.CONCURRENT_GENERATION_IN_PROGRESS;
  public readonly status = 409;
  constructor(message = 'A review draft generation is already in progress for this session') {
    super(message);
    this.name = 'ConcurrentGenerationError';
  }
}

export class IdempotencyConflictError extends Error {
  public readonly code = ErrorCodes.IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH;
  public readonly status = 409;
  constructor(message = 'Client draft ID was already submitted with different input parameters') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class LeaseLostError extends Error {
  public readonly code = 'LEASE_LOST';
  public readonly status = 409;
  constructor(message = 'Generation lease was lost or expired before settlement') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

export class OutputGuardrailError extends Error {
  public readonly code = ErrorCodes.OUTPUT_GUARDRAIL_FAILED;
  public readonly status = 422;
  constructor(message: string, public readonly reasonCode?: string) {
    super(message);
    this.name = 'OutputGuardrailError';
  }
}

// --- Helper Functions ---

/**
 * Validates and canonicalizes the requested language code.
 * Omitted or undefined defaults to 'en'.
 * Null, non-string, empty, whitespace-only, or invalid length (<2 or >10) strings are rejected.
 */
export function canonicalizeLanguage(language: unknown): string {
  if (language === undefined) {
    return AiAssistantConstants.DEFAULT_LANGUAGE;
  }
  if (typeof language !== 'string') {
    throw new AiValidationError('Language code must be a string when provided');
  }
  const trimmed = language.trim().toLowerCase();
  if (trimmed.length < 2 || trimmed.length > 10) {
    throw new AiValidationError('Language code must be between 2 and 10 characters');
  }
  return trimmed;
}

export interface SessionContext {
  sessionId: string;
  tenantId: string;
  locationId: string;
  campaignId: string;
  generationsRemaining: number;
}

export interface ReplayCheckResult {
  isReplay: boolean;
  draft?: string;
  generationsRemaining: number;
  sessionContext?: SessionContext;
}

/**
 * Checks session existence, business validity, and idempotency cache in a single non-locking query.
 *
 * Replays cannot bypass:
 * - Session expiry
 * - Tenant suspension
 * - Location deactivation or missing Google Review URL
 * - Campaign revocation / inactive status
 *
 * Campaign rotation preserves valid sessions (status remains 'active').
 */
export async function checkSessionAndReplay(
  db: any,
  sessionId: string,
  clientDraftId: string,
  payloadFingerprint: string
): Promise<ReplayCheckResult> {
  const rows = await db.execute(sql`
    SELECT 
      d.id AS draft_id,
      d.payload_fingerprint,
      d.draft_text,
      s.id AS session_id,
      s.tenant_id,
      s.location_id,
      s.campaign_id,
      s.expires_at,
      s.generations_remaining,
      t.status AS tenant_status,
      l.is_active AS location_is_active,
      l.google_review_url,
      c.status AS campaign_status
    FROM ephemeral_sessions s
    JOIN tenants t ON t.id = s.tenant_id
    JOIN locations l ON l.id = s.location_id
    JOIN qr_campaigns c ON c.id = s.campaign_id
    LEFT JOIN ephemeral_session_drafts d 
      ON d.session_id = s.id AND d.client_draft_id = ${clientDraftId}
    WHERE s.id = ${sessionId}
    LIMIT 1;
  `);

  const row = (rows.rows || rows)[0];
  if (!row) {
    throw new InvalidSessionError('Customer session not found');
  }

  // 1. Session Expiry Check
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    throw new InvalidSessionError('Session has expired. Please refresh the page.');
  }

  // 2. Tenant Status Check
  if (row.tenant_status !== 'active') {
    throw new TenantSuspendedError('This business is currently unavailable.');
  }

  // 3. Location Validity Check
  if (!row.location_is_active) {
    throw new CampaignInactiveError('This review campaign is currently inactive.');
  }
  if (!row.google_review_url || String(row.google_review_url).trim() === '') {
    throw new GoogleReviewUrlRequiredError('A valid Google Review URL must be configured for this location.');
  }

  // 4. Campaign Status Check (Active, even if code rotated)
  if (row.campaign_status !== 'active') {
    throw new CampaignInactiveError('This review campaign is currently inactive.');
  }

  // 5. Draft Idempotency Replay Check
  if (row.draft_id) {
    if (row.payload_fingerprint !== payloadFingerprint) {
      throw new IdempotencyConflictError();
    }
    return {
      isReplay: true,
      draft: row.draft_text,
      generationsRemaining: Number(row.generations_remaining),
    };
  }

  // 6. Quota Pre-check for new draft
  const currentQuota = Number(row.generations_remaining);
  if (currentQuota <= 0) {
    throw new QuotaExceededError();
  }

  return {
    isReplay: false,
    generationsRemaining: currentQuota,
    sessionContext: {
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      locationId: row.location_id,
      campaignId: row.campaign_id,
      generationsRemaining: currentQuota,
    },
  };
}

/**
 * Phase 1: Reserves an atomic 30-second lease using clock_timestamp().
 * Uses AiAssistantConstants.LOCK_LEASE_DURATION_SECONDS as the single source of truth.
 */
export async function reserveSessionLease(
  db: any,
  sessionId: string,
  lockToken: string
): Promise<{ generationsRemaining: number }> {
  const leaseSecs = AiAssistantConstants.LOCK_LEASE_DURATION_SECONDS;

  const result = await db.execute(sql`
    UPDATE ephemeral_sessions
    SET generation_lock_token = ${lockToken},
        generation_lock_until = clock_timestamp() + make_interval(secs => ${leaseSecs})
    WHERE id = ${sessionId}
      AND generations_remaining > 0
      AND expires_at > clock_timestamp()
      AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
    RETURNING id, generations_remaining;
  `);

  const updatedRow = (result.rows || result)[0];
  if (updatedRow) {
    return { generationsRemaining: Number(updatedRow.generations_remaining) };
  }

  // If 0 rows were updated, determine specific rejection reason
  const checkResult = await db.execute(sql`
    SELECT expires_at, generations_remaining, generation_lock_until
    FROM ephemeral_sessions
    WHERE id = ${sessionId};
  `);
  const sessionRow = (checkResult.rows || checkResult)[0];
  if (!sessionRow) {
    throw new InvalidSessionError('Customer session not found');
  }

  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    throw new InvalidSessionError('Session has expired. Please refresh the page.');
  }

  if (Number(sessionRow.generations_remaining) <= 0) {
    throw new QuotaExceededError();
  }

  // Lock must be active
  throw new ConcurrentGenerationError();
}

/**
 * Fenced lease release for normal failure paths (provider timeout, provider error, guardrail failure).
 * Fenced with dual predicate: generation_lock_token = $lockToken AND generation_lock_until > clock_timestamp().
 * Returns the session's live remaining quota from PostgreSQL.
 */
export async function releaseSessionLease(
  db: any,
  sessionId: string,
  lockToken: string
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE ephemeral_sessions
    SET generation_lock_token = NULL,
        generation_lock_until = NULL
    WHERE id = ${sessionId}
      AND generation_lock_token = ${lockToken}
      AND generation_lock_until > clock_timestamp()
    RETURNING generations_remaining;
  `);

  const row = (result.rows || result)[0];
  if (row) {
    return Number(row.generations_remaining);
  }

  // If 0 rows updated (e.g. lease expired or taken over), read current live quota safely
  const queryResult = await db.execute(sql`
    SELECT generations_remaining
    FROM ephemeral_sessions
    WHERE id = ${sessionId};
  `);
  const sessionRow = (queryResult.rows || queryResult)[0];
  return sessionRow ? Number(sessionRow.generations_remaining) : 0;
}

export interface SettleDraftParams {
  sessionId: string;
  tenantId: string;
  locationId: string;
  campaignId: string;
  lockToken: string;
  expectedQuota: number;
  clientDraftId: string;
  payloadFingerprint: string;
  draftText: string;
}

/**
 * Phase 2: Atomic Settlement Transaction.
 *
 * Follows strict global monotonic lock hierarchy:
 * Level 1: tenants FOR SHARE
 * Level 2: locations FOR SHARE
 * Level 3: qr_campaigns FOR SHARE
 * Level 4: ephemeral_sessions FOR UPDATE
 *
 * Decrements generations_remaining by exactly 1, clears the lease,
 * inserts into ephemeral_session_drafts, and commits.
 *
 * If draft insert or quota decrement fails, the transaction rolls back completely.
 */
export async function settleDraftGeneration(
  db: any,
  params: SettleDraftParams
): Promise<{ generationsRemaining: number; draftId: string }> {
  return await db.transaction(async (tx: any) => {
    // 1. Lock Tenant (Level 1)
    const tRows = await tx.execute(sql`
      SELECT id, status FROM tenants WHERE id = ${params.tenantId} FOR SHARE;
    `);
    const tenant = (tRows.rows || tRows)[0];
    if (!tenant || tenant.status !== 'active') {
      throw new TenantSuspendedError('This business is currently unavailable.');
    }

    // 2. Lock Location (Level 2)
    const lRows = await tx.execute(sql`
      SELECT id, is_active, google_review_url FROM locations WHERE id = ${params.locationId} FOR SHARE;
    `);
    const loc = (lRows.rows || lRows)[0];
    if (!loc || !loc.is_active) {
      throw new CampaignInactiveError('This review campaign is currently inactive.');
    }
    if (!loc.google_review_url || String(loc.google_review_url).trim() === '') {
      throw new GoogleReviewUrlRequiredError('A valid Google Review URL must be configured for this location.');
    }

    // 3. Lock Campaign (Level 3)
    const cRows = await tx.execute(sql`
      SELECT id, status FROM qr_campaigns WHERE id = ${params.campaignId} FOR SHARE;
    `);
    const camp = (cRows.rows || cRows)[0];
    if (!camp || camp.status !== 'active') {
      throw new CampaignInactiveError('This review campaign is currently inactive.');
    }

    // 4. Lock Session (Level 4)
    const sRows = await tx.execute(sql`
      SELECT id, expires_at, generations_remaining, generation_lock_token, generation_lock_until
      FROM ephemeral_sessions
      WHERE id = ${params.sessionId}
      FOR UPDATE;
    `);
    const session = (sRows.rows || sRows)[0];
    if (!session) {
      throw new InvalidSessionError('Customer session not found');
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      throw new InvalidSessionError('Session has expired. Please refresh the page.');
    }

    if (session.generation_lock_token !== params.lockToken) {
      throw new LeaseLostError('Generation lease was claimed by another worker');
    }

    if (new Date(session.generation_lock_until).getTime() <= Date.now()) {
      throw new LeaseLostError('Generation lease has expired');
    }

    const currentQuota = Number(session.generations_remaining);
    if (currentQuota !== params.expectedQuota || currentQuota <= 0) {
      throw new QuotaExceededError();
    }

    // 5. Fenced Quota Decrement & Lease Clearance
    const updateResult = await tx.execute(sql`
      UPDATE ephemeral_sessions
      SET generations_remaining = generations_remaining - 1,
          generation_lock_token = NULL,
          generation_lock_until = NULL
      WHERE id = ${params.sessionId}
        AND generation_lock_token = ${params.lockToken}
        AND generation_lock_until > clock_timestamp()
        AND generations_remaining = ${params.expectedQuota}
        AND generations_remaining > 0
      RETURNING generations_remaining;
    `);
    const updated = (updateResult.rows || updateResult)[0];
    if (!updated) {
      throw new LeaseLostError('Fenced quota update failed: lease expired or quota mismatch');
    }
    const newGenerationsRemaining = Number(updated.generations_remaining);

    // 6. Atomic Draft Insertion
    const insertResult = await tx.execute(sql`
      INSERT INTO ephemeral_session_drafts (
        id,
        session_id,
        client_draft_id,
        payload_fingerprint,
        draft_text,
        generations_remaining_at_settlement,
        created_at
      ) VALUES (
        gen_random_uuid(),
        ${params.sessionId},
        ${params.clientDraftId},
        ${params.payloadFingerprint},
        ${params.draftText},
        ${newGenerationsRemaining},
        clock_timestamp()
      )
      RETURNING id;
    `);
    const insertedDraft = (insertResult.rows || insertResult)[0];
    if (!insertedDraft) {
      throw new Error('Draft insertion failed');
    }

    return {
      generationsRemaining: newGenerationsRemaining,
      draftId: insertedDraft.id,
    };
  });
}
