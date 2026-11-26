import { sql, inArray } from 'drizzle-orm';
import { ephemeralSessions, privateFeedback, privateFeedbackServices } from '../drizzle/schema.js';

let startupTimer: NodeJS.Timeout | null = null;
let cleanupIntervalTimer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Runs one batch of the cleanup job:
 * 1. Purges unsubmitted expired sessions in batches (max 500 per run).
 * 2. Purges customer contact details on feedback older than 30 days per data retention policy.
 * 3. Purges private feedback older than 365 days along with service associations and submitted sessions.
 */
export async function runCleanupNow(db: any): Promise<{
  deletedSessions: number;
  purgedContacts: number;
  purgedFeedback: number;
}> {
  if (isRunning) {
    return { deletedSessions: 0, purgedContacts: 0, purgedFeedback: 0 };
  }

  isRunning = true;
  try {
    // 1. Batch delete unsubmitted expired sessions older than 24 hours
    let deletedSessions = 0;
    const MAX_BATCHES = 10;
    let sessionBatches = 0;
    while (sessionBatches < MAX_BATCHES) {
      sessionBatches++;
      const count = await db.transaction(async (tx: any) => {
        const candidates = await tx
          .select({ id: ephemeralSessions.id })
          .from(ephemeralSessions)
          .where(
            sql`${ephemeralSessions.expiresAt} < NOW() - INTERVAL '24 hours' AND ${ephemeralSessions.feedbackSubmittedAt} IS NULL`
          )
          .limit(500);

        if (candidates.length === 0) return 0;

        const ids = candidates.map((c: any) => c.id);
        await tx.delete(ephemeralSessions).where(inArray(ephemeralSessions.id, ids));
        return ids.length;
      });

      deletedSessions += count;
      if (count < 500) break;
    }

    // 2. Early privacy purge: Nullify customer contact details on private feedback older than 30 days
    const contactUpdate = await db.execute(
      sql`UPDATE "private_feedback" 
          SET "customer_contact" = NULL, "updated_at" = NOW() 
          WHERE "created_at" < NOW() - INTERVAL '30 days' 
            AND "customer_contact" IS NOT NULL
          RETURNING id`
    );

    const rows = (contactUpdate as any)?.rows ?? (Array.isArray(contactUpdate) ? contactUpdate : []);
    const rowCount = (contactUpdate as any)?.rowCount ?? (contactUpdate as any)?.affectedRows ?? rows.length;
    const purgedContacts = rows.length > 0 ? rows.length : rowCount;

    // 3. 365-day feedback retention purge: Batched deletion of private feedback older than 365 days
    let purgedFeedback = 0;
    let feedbackBatches = 0;
    while (feedbackBatches < MAX_BATCHES) {
      feedbackBatches++;
      const count = await db.transaction(async (tx: any) => {
        const candidates = await tx
          .select({
            id: privateFeedback.id,
            sessionId: privateFeedback.sessionId,
          })
          .from(privateFeedback)
          .where(sql`${privateFeedback.createdAt} < NOW() - INTERVAL '365 days'`)
          .limit(500);

        if (candidates.length === 0) return 0;

        const fbIds = candidates.map((c: any) => c.id);
        const sessionIds = candidates
          .map((c: any) => c.sessionId)
          .filter(Boolean);

        // Explicitly delete associations first, then feedback
        await tx
          .delete(privateFeedbackServices)
          .where(inArray(privateFeedbackServices.feedbackId, fbIds));

        await tx
          .delete(privateFeedback)
          .where(inArray(privateFeedback.id, fbIds));

        // Clean up corresponding submitted session records
        if (sessionIds.length > 0) {
          await tx
            .delete(ephemeralSessions)
            .where(inArray(ephemeralSessions.id, sessionIds));
        }

        return fbIds.length;
      });

      purgedFeedback += count;
      if (count < 500) break;
    }

    return {
      deletedSessions,
      purgedContacts,
      purgedFeedback,
    };
  } catch (err) {
    // Log error without crashing process
    console.error('[CleanupJob] Error executing scheduled cleanup:', err);
    return { deletedSessions: 0, purgedContacts: 0, purgedFeedback: 0 };
  } finally {
    isRunning = false;
  }
}

export interface CleanupJobOptions {
  initialDelayMs?: number;
  intervalMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 30 * 60 * 1000; // 30 minutes deferred startup
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours recurring interval

/**
 * Starts the background in-process cleanup runner:
 * - Defers the initial table scan by 30 minutes after startup to relieve cold boot DB contention.
 * - Schedules recurring execution every 24 hours thereafter.
 * - Unrefs timers so tests and process shutdowns are never blocked.
 * - Idempotent: avoids duplicate scheduling if already running.
 */
export function startCleanupJob(db: any, options?: CleanupJobOptions): void {
  // If already active, don't duplicate timers
  if (startupTimer !== null || cleanupIntervalTimer !== null) {
    return;
  }

  const initialDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const interval = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

  startupTimer = setTimeout(async () => {
    startupTimer = null;
    try {
      await runCleanupNow(db);
    } catch (err) {
      console.error('[CleanupJob] Deferred startup run failed:', err);
    }

    // After initial deferred run completes, start 24-hour recurring interval
    cleanupIntervalTimer = setInterval(async () => {
      try {
        await runCleanupNow(db);
      } catch (err) {
        console.error('[CleanupJob] Recurring run failed:', err);
      }
    }, interval);

    if (cleanupIntervalTimer.unref) {
      cleanupIntervalTimer.unref();
    }
  }, initialDelay);

  if (startupTimer.unref) {
    startupTimer.unref();
  }
}

export function stopCleanupJob(): void {
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (cleanupIntervalTimer !== null) {
    clearInterval(cleanupIntervalTimer);
    cleanupIntervalTimer = null;
  }
}
