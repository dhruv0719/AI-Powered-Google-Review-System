export const ALLOWED_GOOGLE_HOSTS = [
  'search.google.com',
  'g.page',
  'maps.app.goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
] as const;

/**
 * Validates a Google Review URL using strict structural rules:
 * - Must use HTTPS protocol.
 * - Must belong to an allowed Google domain.
 * - Must not contain embedded credentials or unsupported schemes.
 * - Max length: 1024 characters.
 *
 * NOTE: This is an in-memory structural validation. It NEVER makes an outbound network request (zero SSRF risk).
 * Structural validity does not guarantee that the review dialog will open or that the Place ID exists on Google.
 */
export function isValidGoogleReviewUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }

  const trimmed = urlStr.trim();
  if (trimmed.length > 1024 || trimmed.length < 10) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    // Protocol must be strictly https:
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Must not contain credentials (e.g. https://user:pass@google.com)
    if (parsed.username || parsed.password) {
      return false;
    }

    // Hostname must be in allowed list (case-insensitive)
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_GOOGLE_HOSTS.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
    );

    if (!isAllowedHost) {
      return false;
    }

    // Path must not be root alone without query/hash
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
