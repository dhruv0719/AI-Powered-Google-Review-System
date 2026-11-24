import crypto from 'node:crypto';
import { canonicalizeLanguage } from './session_guard.js';

export interface FingerprintPayloadInput {
  feedback: string;
  rating?: number | null;
  serviceIds?: string[];
  language?: unknown;
}

/**
 * Computes a deterministic SHA-256 payload fingerprint.
 *
 * Uses deterministic canonical serialization and cryptographic hashing,
 * with structural ambiguity eliminated by canonical serialization.
 *
 * Keys in canonical structure:
 * - canonicalLanguage: lowercase canonical language code (defaults to 'en' if undefined)
 * - feedback: NFC normalized and trimmed customer feedback text
 * - rating: integer 1-5 or null
 * - serviceIds: deduplicated, lowercase, lexicographically sorted UUID strings
 */
export function computePayloadFingerprint(input: FingerprintPayloadInput): string {
  // 1. Canonicalize feedback: Unicode NFC normalization and trimming
  const canonicalFeedback = (input.feedback ?? '').normalize('NFC').trim();

  // 2. Canonicalize rating: integer 1-5 or null
  const canonicalRating =
    typeof input.rating === 'number' && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5
      ? input.rating
      : null;

  // 3. Canonicalize service IDs: deduplicate and sort alphabetically
  const canonicalServices = Array.from(
    new Set((input.serviceIds ?? []).map((id) => id.trim().toLowerCase()))
  ).sort();

  // 4. Canonicalize language: strict validation; undefined defaults to 'en'
  const canonicalLanguage = canonicalizeLanguage(input.language);

  // 5. Canonical structured serialization (lexicographically ordered keys)
  const canonicalPayload = {
    canonicalLanguage,
    feedback: canonicalFeedback,
    rating: canonicalRating,
    serviceIds: canonicalServices,
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload), 'utf8')
    .digest('hex');
}
