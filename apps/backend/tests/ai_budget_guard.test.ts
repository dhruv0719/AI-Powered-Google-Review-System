import { describe, it, expect, beforeEach } from 'vitest';
import { AiBudgetGuard } from '../src/ai/budget_guard.js';

describe('AiBudgetGuard (In-Process Groq Free Tier Protection)', () => {
  let guard: AiBudgetGuard;

  beforeEach(() => {
    guard = new AiBudgetGuard({
      maxRequestsPerMinute: 3,
      maxTokensPerMinute: 2000,
      maxRequestsPerDay: 5,
      maxTokensPerDay: 5000,
      maxConcurrentRequests: 2,
    });
  });

  it('1. should dynamically estimate token demand accounting for prompt size and 500 completion tokens', () => {
    const shortPrompt = [{ content: 'Great service and quick delivery!' }]; // ~34 chars -> ~10 tokens + 500 = 510
    const longPrompt = [{ content: 'A'.repeat(700) }]; // 700 chars -> 200 tokens + 500 = 700

    const shortEstimate = guard.estimateTokens(shortPrompt, 500);
    const longEstimate = guard.estimateTokens(longPrompt, 500);

    expect(shortEstimate).toBeGreaterThanOrEqual(510);
    expect(shortEstimate).toBeLessThan(520);

    expect(longEstimate).toBe(700);
    expect(longEstimate).toBeGreaterThan(shortEstimate);
  });

  it('2. should enforce max concurrent in-flight requests', () => {
    // Acquire 1
    const r1 = guard.acquireBudget(500);
    expect(r1.allowed).toBe(true);
    expect(guard.getActiveRequests()).toBe(1);

    // Acquire 2 (reaches maxConcurrent: 2)
    const r2 = guard.acquireBudget(500);
    expect(r2.allowed).toBe(true);
    expect(guard.getActiveRequests()).toBe(2);

    // Acquire 3 (should be rejected)
    const r3 = guard.acquireBudget(500);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBe(5);
    expect(r3.reason).toContain('concurrent');

    // Release 1 slot
    guard.releaseBudget(500);
    expect(guard.getActiveRequests()).toBe(1);

    // Now acquire succeeds
    const r4 = guard.acquireBudget(500);
    expect(r4.allowed).toBe(true);
  });

  it('3. should enforce per-minute request rate limit (RPM)', () => {
    const now = 1700000000000;

    // 3 requests within minute (maxRequestsPerMinute: 3)
    expect(guard.acquireBudget(100, now).allowed).toBe(true);
    guard.releaseBudget(100);

    expect(guard.acquireBudget(100, now + 1000).allowed).toBe(true);
    guard.releaseBudget(100);

    expect(guard.acquireBudget(100, now + 2000).allowed).toBe(true);
    guard.releaseBudget(100);

    // 4th request in same minute should be rejected
    const r4 = guard.acquireBudget(100, now + 3000);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.reason).toContain('Per-minute AI request rate limit');

    // After 61 seconds, window slides and permits new request
    const r5 = guard.acquireBudget(100, now + 62000);
    expect(r5.allowed).toBe(true);
  });

  it('4. should enforce per-minute token budget (TPM) dynamically without hardcoding 8 req/min', () => {
    const now = 1700000000000;

    // First request with 1,200 tokens
    expect(guard.acquireBudget(1200, now).allowed).toBe(true);
    guard.releaseBudget(1200);

    // Second request with 900 tokens (1,200 + 900 = 2,100 > 2,000 maxTpm)
    const r2 = guard.acquireBudget(900, now + 1000);
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toContain('token budget');

    // Smaller request (700 tokens: 1,200 + 700 = 1,900 <= 2,000) is allowed!
    const r3 = guard.acquireBudget(700, now + 1000);
    expect(r3.allowed).toBe(true);
  });

  it('5. should enforce daily limits and roll over across UTC midnight', () => {
    const day1 = new Date('2026-11-26T10:00:00Z').getTime();

    // Consume 5 daily requests (maxRequestsPerDay: 5)
    for (let i = 0; i < 5; i++) {
      // Advance by 61s each time so minute limiter does not trigger
      const t = day1 + i * 65000;
      const res = guard.acquireBudget(100, t);
      expect(res.allowed).toBe(true);
      guard.releaseBudget(100);
    }

    // 6th request on same day should be rejected due to daily quota
    const rejected = guard.acquireBudget(100, day1 + 5 * 65000);
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toContain('Daily AI request quota');

    // Next day (UTC midnight rollover)
    const day2 = new Date('2026-11-27T00:05:00Z').getTime();
    const nextDayRes = guard.acquireBudget(100, day2);
    expect(nextDayRes.allowed).toBe(true);
  });

  it('6. should reconcile actual token usage when reported by provider', () => {
    const now = 1700000000000;
    guard.acquireBudget(800, now);

    // Provider returns actual token count 650 (150 fewer than estimated)
    guard.releaseBudget(800, 650);

    const usage = guard.getDailyUsage(now);
    expect(usage.tokens).toBe(650);
  });
});
