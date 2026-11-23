import { describe, it, expect } from 'vitest';
import { isValidGoogleReviewUrl } from '@review-system/shared';

describe('Google Review URL Structural Validator Unit Tests', () => {
  it('should accept valid standard Google Review URLs', () => {
    // 1. Google Business Profile Short URL
    expect(isValidGoogleReviewUrl('https://g.page/r/CbGQ2j4example/review')).toBe(true);

    // 2. Google Search Local Write Review URL
    expect(
      isValidGoogleReviewUrl(
        'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
      )
    ).toBe(true);

    // 3. Google Maps App Share URL
    expect(isValidGoogleReviewUrl('https://maps.app.goo.gl/3NqYabcXYZ123')).toBe(true);

    // 4. Google Maps CID Link
    expect(isValidGoogleReviewUrl('https://maps.google.com/?cid=10293847561029384756')).toBe(true);

    // 5. Google Maps Full Place Review Link
    expect(
      isValidGoogleReviewUrl(
        'https://www.google.com/maps/place/Apex+Auto/@12.9716,77.5946,17z/data=!4m7!3m6!1s0x3bae1670c9b44e6d:0xf8d0718324f923b0'
      )
    ).toBe(true);
  });

  it('should reject insecure HTTP protocol', () => {
    expect(isValidGoogleReviewUrl('http://g.page/r/CbGQ2j4example/review')).toBe(false);
    expect(
      isValidGoogleReviewUrl(
        'http://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
      )
    ).toBe(false);
  });

  it('should reject non-Google phishing or lookalike domains', () => {
    expect(isValidGoogleReviewUrl('https://g.page.evilphish.com/r/review')).toBe(false);
    expect(isValidGoogleReviewUrl('https://google.com.attacker.com/writereview')).toBe(false);
    expect(isValidGoogleReviewUrl('https://search-google.com/local/writereview')).toBe(false);
    expect(isValidGoogleReviewUrl('https://fake-maps.com/review')).toBe(false);
  });

  it('should reject URLs with embedded credentials (user:pass@host)', () => {
    expect(isValidGoogleReviewUrl('https://user:password@g.page/r/CbGQ2j4example/review')).toBe(false);
    expect(isValidGoogleReviewUrl('https://admin@search.google.com/local/writereview')).toBe(false);
  });

  it('should reject non-HTTP schemes and injection attempts', () => {
    expect(isValidGoogleReviewUrl('javascript:alert(1)')).toBe(false);
    expect(isValidGoogleReviewUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidGoogleReviewUrl('file:///etc/passwd')).toBe(false);
  });

  it('should reject empty, malformed, or excessive length strings', () => {
    expect(isValidGoogleReviewUrl('')).toBe(false);
    expect(isValidGoogleReviewUrl('   ')).toBe(false);
    expect(isValidGoogleReviewUrl('not-a-url')).toBe(false);
    expect(isValidGoogleReviewUrl('https://google.com/')).toBe(false); // Root only without path/query

    // Exceeds 1024 characters
    const longUrl = 'https://search.google.com/local/writereview?placeid=' + 'a'.repeat(1000);
    expect(isValidGoogleReviewUrl(longUrl)).toBe(false);
  });
});
