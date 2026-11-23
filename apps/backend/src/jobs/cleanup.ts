import { sql, inArray } from 'drizzle-orm';
import { ephemeralSessions, privateFeedback } from '../drizzle/schema.js';

let cleanupTimer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Runs one batch of the cleanup job:
 * 1. Purges unsubmitted expired sessions in batches (max 500 per run).
 * 2. Purges customer contact details on feedback older than 30 days per data retention policy.
 */
export async function runCleanupNow(db: any): Promise<{ deletedSessions: number; purgedContacts: number }> {
  if (isRunning) {
    return { deletedSessions: 0, purgedContacts: 0 };
  }

  isRunning = true;
  try {
    // 1. Batch delete unsubmitted expired sessions older than 24 hours
    const deletedSessions = await db.transaction(async (tx: any) => {
      // Find candidate session IDs
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

    return {
      deletedSessions,
      purgedContacts: rows.length > 0 ? rows.length : rowCount,
    };
  } catch (err) {
    // Log error without crashing process
    console.error('[CleanupJob] Error executing scheduled cleanup:', err);
    return { deletedSessions: 0, purgedContacts: 0 };
  } finally {
    isRunning = false;
  }
}

/**
 * Starts the background in-process cleanup runner:
 * - Executes immediately once on startup.
 * - Schedules recurring execution every 24 hours.
 */
export function startCleanupJob(db: any): void {
  // Initial run on startup
  runCleanupNow(db).catch((err) => {
    console.error('[CleanupJob] Startup run failed:', err);
  });

  // 24-hour interval
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  cleanupTimer = setInterval(() => {
    runCleanupNow(db).catch((err) => {
      console.error('[CleanupJob] Recurring run failed:', err);
    });
  }, TWENTY_FOUR_HOURS_MS);

  // Unref timer so it does not keep test runners or process alive unintentionally
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

export function stopCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
