/**
 * In-Memory Global AI Request and Token Budget Guard
 *
 * ARCHITECTURE CONSTRAINTS & LIMITATIONS:
 * NOTE: This in-memory budget guard is valid ONLY for the single-instance Render deployment.
 * In a multi-instance or horizontal cluster deployment, this limiter must be replaced with
 * an atomic shared store (e.g. Redis/Valkey token bucket). In the current single-instance
 * staging environment, it prevents the application from exceeding Groq free-tier rate limits.
 *
 * Groq Free Tier Limits for 'openai/gpt-oss-20b':
 * - 30 Requests Per Minute (RPM)
 * - 8,000 Tokens Per Minute (TPM)
 * - 1,000 Requests Per Day (RPD)
 * - 200,000 Tokens Per Day (TPD)
 *
 * Enforced Conservative Single-Instance Ceilings:
 * - maxRequestsPerMinute: 15 (50% margin below 30 RPM)
 * - maxTokensPerMinute: 7,000 (1,000 TPM safety margin below 8,000 TPM)
 * - maxRequestsPerDay: 850 (150 request margin below 1,000 RPD)
 * - maxTokensPerDay: 160,000 (40,000 token margin below 200,000 TPD)
 * - maxConcurrentRequests: 3 (bounds simultaneous in-flight provider calls)
 *
 * PRIVACY INVARIANT:
 * This guard strictly tracks token counts, request timestamps, and numbers.
 * It NEVER logs, retains, or exposes customer feedback text or generated review content.
 */

export interface AiBudgetOptions {
  maxRequestsPerMinute?: number;
  maxTokensPerMinute?: number;
  maxRequestsPerDay?: number;
  maxTokensPerDay?: number;
  maxConcurrentRequests?: number;
}

interface TokenRecord {
  timestamp: number;
  tokens: number;
}

export class AiBudgetGuard {
  private readonly maxRpm: number;
  private readonly maxTpm: number;
  private readonly maxRpd: number;
  private readonly maxTpd: number;
  private readonly maxConcurrent: number;

  private activeRequests = 0;
  private requestTimestamps: number[] = [];
  private tokenRecords: TokenRecord[] = [];

  // Daily tracking keyed by UTC date string 'YYYY-MM-DD'
  private currentDayKey = '';
  private dailyRequestCount = 0;
  private dailyTokenCount = 0;

  constructor(options?: AiBudgetOptions) {
    this.maxRpm = options?.maxRequestsPerMinute ?? 15;
    this.maxTpm = options?.maxTokensPerMinute ?? 7000;
    this.maxRpd = options?.maxRequestsPerDay ?? 850;
    this.maxTpd = options?.maxTokensPerDay ?? 160000;
    this.maxConcurrent = options?.maxConcurrentRequests ?? 3;
    this.rolloverDayIfNeeded();
  }

  private rolloverDayIfNeeded(now = Date.now()): void {
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.currentDayKey !== today) {
      this.currentDayKey = today;
      this.dailyRequestCount = 0;
      this.dailyTokenCount = 0;
    }
  }

  private pruneMinuteWindows(now = Date.now()): void {
    const cutoff = now - 60000;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! <= cutoff) {
      this.requestTimestamps.shift();
    }
    while (this.tokenRecords.length > 0 && this.tokenRecords[0]!.timestamp <= cutoff) {
      this.tokenRecords.shift();
    }
  }

  /**
   * Dynamically estimates token count from prompt messages based on character length
   * plus the enforced max completion tokens (500).
   * Conservative heuristic: ~3.5 chars per token for English/multilingual text + 500 completion.
   */
  public estimateTokens(promptMessages: { content: string }[], maxCompletionTokens = 500): number {
    const totalChars = promptMessages.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedPromptTokens = Math.ceil(totalChars / 3.5);
    return Math.max(10, estimatedPromptTokens) + maxCompletionTokens;
  }

  /**
   * Attempts to reserve capacity for an AI generation request.
   * If budget is available, increments active concurrency and window tracking.
   * If exhausted, returns allowed: false with accurate retryAfterSeconds.
   */
  public acquireBudget(
    estimatedTokens: number,
    now = Date.now()
  ): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
    this.rolloverDayIfNeeded(now);
    this.pruneMinuteWindows(now);

    // 1. Check concurrency limit
    if (this.activeRequests >= this.maxConcurrent) {
      return {
        allowed: false,
        retryAfterSeconds: 5,
        reason: 'Maximum concurrent AI generations reached',
      };
    }

    // 2. Check minute request limit (RPM)
    if (this.requestTimestamps.length >= this.maxRpm) {
      const oldest = this.requestTimestamps[0]!;
      const retryAfter = Math.max(1, Math.ceil((oldest + 60000 - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Per-minute AI request rate limit reached',
      };
    }

    // 3. Check minute token limit (TPM)
    const currentTokensInWindow = this.tokenRecords.reduce((sum, r) => sum + r.tokens, 0);
    if (currentTokensInWindow + estimatedTokens > this.maxTpm) {
      const oldest = this.tokenRecords[0];
      const retryAfter = oldest ? Math.max(1, Math.ceil((oldest.timestamp + 60000 - now) / 1000)) : 10;
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Per-minute AI token budget reached',
      };
    }

    // 4. Check daily request limit (RPD)
    if (this.dailyRequestCount >= this.maxRpd) {
      const tomorrowUtc = new Date(now);
      tomorrowUtc.setUTCHours(24, 0, 0, 0);
      const retryAfter = Math.max(60, Math.ceil((tomorrowUtc.getTime() - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Daily AI request quota reached',
      };
    }

    // 5. Check daily token limit (TPD)
    if (this.dailyTokenCount + estimatedTokens > this.maxTpd) {
      const tomorrowUtc = new Date(now);
      tomorrowUtc.setUTCHours(24, 0, 0, 0);
      const retryAfter = Math.max(60, Math.ceil((tomorrowUtc.getTime() - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Daily AI token quota reached',
      };
    }

    // Reservation succeeded: record reservation
    this.activeRequests++;
    this.requestTimestamps.push(now);
    this.tokenRecords.push({ timestamp: now, tokens: estimatedTokens });
    this.dailyRequestCount++;
    this.dailyTokenCount += estimatedTokens;

    return { allowed: true };
  }

  /**
   * Releases one active concurrency slot and optionally reconciles estimated
   * tokens with actual tokens reported by the provider.
   */
  public releaseBudget(estimatedTokens: number, actualTokens?: number): void {
    if (this.activeRequests > 0) {
      this.activeRequests--;
    }

    if (actualTokens !== undefined && actualTokens >= 0) {
      const tokenDiff = actualTokens - estimatedTokens;
      // Adjust last recorded token entry if within current window
      if (this.tokenRecords.length > 0) {
        const last = this.tokenRecords[this.tokenRecords.length - 1]!;
        last.tokens = Math.max(0, last.tokens + tokenDiff);
      }
      this.dailyTokenCount = Math.max(0, this.dailyTokenCount + tokenDiff);
    }
  }

  public getActiveRequests(): number {
    return this.activeRequests;
  }

  public getDailyUsage(now = Date.now()): { requests: number; tokens: number } {
    this.rolloverDayIfNeeded(now);
    return {
      requests: this.dailyRequestCount,
      tokens: this.dailyTokenCount,
    };
  }

  public reset(): void {
    this.activeRequests = 0;
    this.requestTimestamps = [];
    this.tokenRecords = [];
    this.dailyRequestCount = 0;
    this.dailyTokenCount = 0;
  }
}
