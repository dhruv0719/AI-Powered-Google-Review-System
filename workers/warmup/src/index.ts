/**
 * Cloudflare Scheduled Warm-Up Worker (Source Preparation Only)
 *
 * PURPOSE:
 * Periodically pings the Render backend's liveness endpoint (`GET /health`)
 * to prevent the free instance from spinning down during store operating hours.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Target Endpoint: MUST call `GET /health` ONLY. NEVER call `/ready`.
 *    `/health` tests process liveness without touching Neon PostgreSQL.
 *    `/ready` executes a database query, which would wake or keep Neon active unnecessarily.
 * 2. Operating Hours (India Standard Time - UTC+5:30):
 *    - Pre-warm window starts: 9:54 AM IST (04:24 UTC) to have Render fully warm by 10:00 AM shop opening.
 *    - Operating window closes: 9:00 PM IST (15:30 UTC) when physical client locations close.
 *    - UTC Minute Boundaries: 04:24 UTC (264 mins) through 15:30 UTC (930 mins).
 * 3. Cron Schedule: `* /6 4-15 * * *` fires every 6 minutes between 04:00 and 15:59 UTC.
 *    - Triggers at 04:00, 04:06, 04:12, 04:18 (< 04:24 UTC) are safely SKIPPED.
 *    - Triggers from 04:24 UTC through 15:30 UTC SEND PINGS (112 pings/day).
 *    - Triggers at 15:36, 15:42, 15:48, 15:54 (> 15:30 UTC) are safely SKIPPED.
 *    - Off-hours (16:00 to 03:59 UTC) are NOT scheduled, consuming 0 Worker invocations.
 * 4. Safety & Failure Handling:
 *    - 10-second timeout via AbortController.
 *    - Handles transient network drops gracefully without unhandled promise rejections.
 *    - NEVER exposes API keys, database credentials, or proxy secrets.
 *    - Completely isolated from Cloudflare Pages `_routes.json`.
 */

export interface Env {
  BACKEND_HEALTH_URL?: string;
}

export interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

// 04:24 UTC = 4 * 60 + 24 = 264 minutes
export const WARMUP_START_UTC_MINUTES = 264;
// 15:30 UTC = 15 * 60 + 30 = 930 minutes
export const WARMUP_END_UTC_MINUTES = 930;

/**
 * Checks whether the given timestamp falls within the IST pre-warm operating window
 * (04:24 UTC to 15:30 UTC inclusive).
 */
export function isWithinWarmupWindow(date: Date): boolean {
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const currentUtcMinutes = utcHours * 60 + utcMinutes;

  return currentUtcMinutes >= WARMUP_START_UTC_MINUTES && currentUtcMinutes <= WARMUP_END_UTC_MINUTES;
}

/**
 * Executes one health ping against the configured backend URL with a 10s timeout.
 */
export async function pingBackendHealth(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<{ status: number | 'error'; ok: boolean; message: string }> {
  // Validate that the URL points to /health and NEVER /ready
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/ready') {
      console.error('[WarmupWorker] REJECTED: Warm-up ping to /ready is strictly prohibited.');
      return { status: 'error', ok: false, message: 'Calling /ready is prohibited' };
    }
  } catch {
    console.error('[WarmupWorker] Invalid BACKEND_HEALTH_URL:', url);
    return { status: 'error', ok: false, message: 'Invalid URL' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Cloudflare-Warmup-Worker/1.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return {
      status: response.status,
      ok: response.ok,
      message: `Ping completed with HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[WarmupWorker] Transient failure pinging backend:', errorMsg);
    return {
      status: 'error',
      ok: false,
      message: `Ping failed: ${errorMsg}`,
    };
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: { waitUntil: (p: Promise<any>) => void }): Promise<void> {
    const eventDate = new Date(event.scheduledTime || Date.now());

    if (!isWithinWarmupWindow(eventDate)) {
      console.log(
        `[WarmupWorker] Outside operating window (${eventDate.toISOString()}). Skipping ping.`
      );
      return;
    }

    const healthUrl = env.BACKEND_HEALTH_URL;
    if (!healthUrl) {
      console.error('[WarmupWorker] BACKEND_HEALTH_URL environment variable is not configured.');
      return;
    }

    ctx.waitUntil(
      (async () => {
        const result = await pingBackendHealth(healthUrl);
        console.log(`[WarmupWorker] Result: ${result.message}`);
      })()
    );
  },
};
