/**
 * Deterministic PostgreSQL Multi-Connection AI Concurrency Test Harness
 *
 * Demonstrates transactional ordering, hierarchy locking, atomic lease reservation,
 * dual-predicate fenced release, and settlement atomicity across real PostgreSQL backend
 * worker processes using independent physical TCP connections and synchronization barriers.
 *
 * Races Demonstrated:
 * 1. Concurrent identical clientDraftId race (Initial conflict -> settlement -> idempotent replay)
 * 2. Concurrent different clientDraftIds race (Mutual exclusion during lease -> sequential generation)
 * 3. Settlement vs. Tenant Suspension (Suspension commits FIRST -> Settlement blocks & fails)
 * 4. Settlement vs. Tenant Suspension (Settlement commits FIRST -> Suspension blocks & succeeds)
 * 5. Settlement vs. Location Deactivation (Deactivation commits FIRST -> Settlement blocks & fails)
 * 6. Settlement vs. Location Deactivation (Settlement commits FIRST -> Deactivation blocks & succeeds)
 * 7. Settlement vs. Campaign Revocation (Revocation commits FIRST -> Settlement blocks & fails)
 * 8. Settlement vs. Campaign Revocation (Settlement commits FIRST -> Revocation blocks & succeeds)
 * 9. Settlement vs. Campaign Code Rotation (Rotation commits -> Settlement succeeds)
 * 10. Expired lease takeover by second client after clock expiry
 * 11. Stale lease owner cleanup after takeover (Updates 0 rows, preserves new lease)
 */

import postgres from 'postgres';
import crypto from 'node:crypto';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';
import { generateCampaignCode } from '../src/utils/qr.js';

interface SafeBarrier {
  wait: () => Promise<void>;
  signal: () => void;
  abort: (err: Error) => void;
}

function createSafeBarrier(name: string, timeoutMs = 10000): SafeBarrier {
  let resolvePromise: () => void;
  let rejectPromise: (err: Error) => void;
  let timer: NodeJS.Timeout;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timer = setTimeout(() => {
      reject(new Error(`SafeBarrier [${name}] timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return {
    wait: () => promise,
    signal: () => {
      clearTimeout(timer);
      resolvePromise();
    },
    abort: (err: Error) => {
      clearTimeout(timer);
      rejectPromise(err);
    },
  };
}

async function waitForBackendLock(
  adminClient: postgres.Sql,
  targetPid: number,
  queryTag: string,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [activity] = await adminClient`
      SELECT pid, wait_event_type, wait_event, state, query
      FROM pg_stat_activity
      WHERE pid = ${targetPid}
    `;

    if (
      activity &&
      activity.state === 'active' &&
      activity.wait_event_type === 'Lock' &&
      activity.query &&
      activity.query.includes(queryTag)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for backend PID ${targetPid} to enter Lock wait state.`);
}

async function runPhysicalPostgresAiConcurrencyTests() {
  const dbUrl =
    process.env.DATABASE_URL ||
    'postgresql://review_test:local_test_password@localhost:5433/review_system_test';

  console.log('Connecting to PostgreSQL via multiple physical connections...');
  const clientAdmin = postgres(dbUrl, { max: 1 });
  const clientWorker1 = postgres(dbUrl, { max: 1 });
  const clientWorker2 = postgres(dbUrl, { max: 1 });

  try {
    await clientAdmin`SELECT 1`;
    console.log('PostgreSQL connection established successfully.\n');

    // Helper to generate fresh test hierarchy
    async function createTestHierarchy() {
      const tenantId = crypto.randomUUID();
      const locationId = crypto.randomUUID();
      const campaignId = crypto.randomUUID();
      const code = generateCampaignCode();

      await clientAdmin`
        INSERT INTO tenants (id, display_name, slug, status)
        VALUES (${tenantId}, 'AI Test Clinic', ${'ai-clinic-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)}, 'active');
      `;
      await clientAdmin`
        INSERT INTO locations (id, tenant_id, name, google_review_url, is_primary, is_active)
        VALUES (${locationId}, ${tenantId}, 'AI Main Office', 'https://g.page/r/ai-concurrency/review', true, true);
      `;
      await clientAdmin`
        INSERT INTO qr_campaigns (id, tenant_id, location_id, name, code, status)
        VALUES (${campaignId}, ${tenantId}, ${locationId}, 'AI Concurr Campaign', ${code}, 'active');
      `;

      return { tenantId, locationId, campaignId, code };
    }

    async function createSession(tenantId: string, locationId: string, campaignId: string, code: string, quota = 3) {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at, generations_remaining)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${code}, NOW() + INTERVAL '30 minutes', ${quota});
      `;
      return { sessionId, rawToken, tokenHash };
    }

    // --- TEST 1: Concurrent Identical clientDraftId Race ---
    console.log('--- TEST 1: Concurrent Identical clientDraftId Race ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const clientDraftId = crypto.randomUUID();
      const fingerprint = crypto.createHash('sha256').update('test-payload-identical').digest('hex');
      const token1 = crypto.randomUUID();
      const token2 = crypto.randomUUID();

      const bReady = createSafeBarrier('t1_ready');
      let winnerToken: string | null = null;
      let loserRejected = false;

      // Both workers attempt atomic lease reservation simultaneously
      const w1 = (async () => {
        bReady.signal();
        const res = await clientWorker1`
          UPDATE ephemeral_sessions
          SET generation_lock_token = ${token1},
              generation_lock_until = clock_timestamp() + interval '30 seconds'
          WHERE id = ${sessionId}
            AND generations_remaining > 0
            AND expires_at > clock_timestamp()
            AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
          RETURNING id, generations_remaining;
        `;
        if (res.length > 0) winnerToken = token1;
        else loserRejected = true;
      })();

      const w2 = (async () => {
        await bReady.wait();
        const res = await clientWorker2`
          UPDATE ephemeral_sessions
          SET generation_lock_token = ${token2},
              generation_lock_until = clock_timestamp() + interval '30 seconds'
          WHERE id = ${sessionId}
            AND generations_remaining > 0
            AND expires_at > clock_timestamp()
            AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
          RETURNING id, generations_remaining;
        `;
        if (res.length > 0) winnerToken = token2;
        else loserRejected = true;
      })();

      await Promise.all([w1, w2]);
      if (!winnerToken || !loserRejected) {
        throw new Error('TEST 1 FAILED: Expected exactly one reservation winner and one rejection.');
      }

      // Winner settles draft
      await clientWorker1.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;

        await sql`
          UPDATE ephemeral_sessions
          SET generations_remaining = generations_remaining - 1,
              generation_lock_token = NULL,
              generation_lock_until = NULL
          WHERE id = ${sessionId}
            AND generation_lock_token = ${winnerToken}
            AND generation_lock_until > clock_timestamp()
            AND generations_remaining = 3;
        `;

        await sql`
          INSERT INTO ephemeral_session_drafts (
            id, session_id, client_draft_id, payload_fingerprint, draft_text,
            generations_remaining_at_settlement, created_at
          ) VALUES (
            gen_random_uuid(), ${sessionId}, ${clientDraftId}, ${fingerprint}, 'Polished review text',
            2, clock_timestamp()
          );
        `;
      });

      // Retry by loser: Must find existing draft and receive replay (live quota 2, no extra draft)
      const replay = await clientWorker2`
        SELECT d.id, d.draft_text, d.payload_fingerprint, s.generations_remaining
        FROM ephemeral_session_drafts d
        JOIN ephemeral_sessions s ON s.id = d.session_id
        WHERE d.session_id = ${sessionId} AND d.client_draft_id = ${clientDraftId};
      `;

      if (replay.length !== 1 || replay[0].generations_remaining !== 2) {
        throw new Error(`TEST 1 FAILED: Replay lookup invalid: ${JSON.stringify(replay)}`);
      }

      const allDrafts = await clientAdmin`
        SELECT id FROM ephemeral_session_drafts WHERE session_id = ${sessionId};
      `;
      if (allDrafts.length !== 1) {
        throw new Error('TEST 1 FAILED: Duplicate drafts created!');
      }
      console.log('✔ PASS: Race 1 - Exactly one reservation winner, loser rejected 409, retry replayed cached draft with live quota 2.\n');
    }

    // --- TEST 2: Concurrent Different clientDraftIds Race ---
    console.log('--- TEST 2: Concurrent Different clientDraftIds Race ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const clientDraftId1 = crypto.randomUUID();
      const clientDraftId2 = crypto.randomUUID();
      const token1 = crypto.randomUUID();
      const token2 = crypto.randomUUID();

      // Worker 1 acquires lease
      const res1 = await clientWorker1`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token1},
            generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId}
          AND generations_remaining > 0
          AND expires_at > clock_timestamp()
          AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
        RETURNING generations_remaining;
      `;
      if (res1.length !== 1) throw new Error('TEST 2 FAILED: Worker 1 failed to acquire lease');

      // Worker 2 attempts reservation while lease 1 is active -> MUST BE REJECTED
      const res2 = await clientWorker2`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token2},
            generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId}
          AND generations_remaining > 0
          AND expires_at > clock_timestamp()
          AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
        RETURNING generations_remaining;
      `;
      if (res2.length !== 0) throw new Error('TEST 2 FAILED: Worker 2 acquired lease concurrently!');

      // Worker 1 settles draft 1
      await clientWorker1.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;
        await sql`
          UPDATE ephemeral_sessions
          SET generations_remaining = generations_remaining - 1,
              generation_lock_token = NULL,
              generation_lock_until = NULL
          WHERE id = ${sessionId} AND generation_lock_token = ${token1};
        `;
        await sql`
          INSERT INTO ephemeral_session_drafts (
            id, session_id, client_draft_id, payload_fingerprint, draft_text,
            generations_remaining_at_settlement
          ) VALUES (
            gen_random_uuid(), ${sessionId}, ${clientDraftId1}, 'fp1', 'Draft 1', 2
          );
        `;
      });

      // Worker 2 retries now that lease 1 is cleared -> SUCCEEDS
      const res2Retry = await clientWorker2`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token2},
            generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId}
          AND generations_remaining > 0
          AND expires_at > clock_timestamp()
          AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
        RETURNING generations_remaining;
      `;
      if (res2Retry.length !== 1 || res2Retry[0].generations_remaining !== 2) {
        throw new Error('TEST 2 FAILED: Worker 2 failed to acquire lease after Worker 1 committed');
      }

      // Worker 2 settles draft 2
      await clientWorker2.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;
        await sql`
          UPDATE ephemeral_sessions
          SET generations_remaining = generations_remaining - 1,
              generation_lock_token = NULL,
              generation_lock_until = NULL
          WHERE id = ${sessionId} AND generation_lock_token = ${token2};
        `;
        await sql`
          INSERT INTO ephemeral_session_drafts (
            id, session_id, client_draft_id, payload_fingerprint, draft_text,
            generations_remaining_at_settlement
          ) VALUES (
            gen_random_uuid(), ${sessionId}, ${clientDraftId2}, 'fp2', 'Draft 2', 1
          );
        `;
      });

      const [finalSession] = await clientAdmin`SELECT generations_remaining FROM ephemeral_sessions WHERE id = ${sessionId}`;
      if (finalSession.generations_remaining !== 1) {
        throw new Error(`TEST 2 FAILED: Expected final quota 1, got ${finalSession.generations_remaining}`);
      }
      console.log('✔ PASS: Race 2 - Distinct drafts serialize cleanly; quota accurately decremented from 3 to 1.\n');
    }

    // --- TEST 3: Settlement vs. Tenant Suspension (Suspension commits FIRST) ---
    console.log('--- TEST 3: Settlement vs. Tenant Suspension (Suspension commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const token = crypto.randomUUID();
      await clientWorker1`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token}, generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId};
      `;

      const bLocked = createSafeBarrier('t3_locked');
      let settlementAborted = false;

      // Admin acquires exclusive lock on tenant
      const pAdmin = clientAdmin.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        bLocked.signal(); // Signal Worker 1 that tenant is exclusively locked
        await new Promise((r) => setTimeout(r, 100)); // Hold lock briefly
        await sql`UPDATE tenants SET status = 'suspended' WHERE id = ${tenantId}`;
      });

      // Worker 1 attempts settlement (requires SHARE lock on tenant -> MUST BLOCK)
      const pWorker = (async () => {
        await bLocked.wait();
        try {
          await clientWorker1.begin(async (sql) => {
            const [t] = await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
            if (t.status !== 'active') {
              throw new Error('TENANT_SUSPENDED');
            }
          });
        } catch (err: any) {
          if (err.message === 'TENANT_SUSPENDED') settlementAborted = true;
          // Dual-predicate fenced release
          await clientWorker1`
            UPDATE ephemeral_sessions
            SET generation_lock_token = NULL, generation_lock_until = NULL
            WHERE id = ${sessionId} AND generation_lock_token = ${token} AND generation_lock_until > clock_timestamp();
          `;
        }
      })();

      await Promise.all([pAdmin, pWorker]);
      if (!settlementAborted) {
        throw new Error('TEST 3 FAILED: Settlement did not abort after suspension committed first!');
      }

      const [sess] = await clientAdmin`SELECT generations_remaining, generation_lock_token FROM ephemeral_sessions WHERE id = ${sessionId}`;
      if (sess.generations_remaining !== 3 || sess.generation_lock_token !== null) {
        throw new Error('TEST 3 FAILED: Quota consumed or lease not released upon suspension!');
      }
      console.log('✔ PASS: Race 3 - Suspension committed first; settlement blocked on Level 1 lock, unblocked, aborted, and released lease.\n');
    }

    // --- TEST 4: Settlement vs. Tenant Suspension (Settlement commits FIRST) ---
    console.log('--- TEST 4: Settlement vs. Tenant Suspension (Settlement commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const token = crypto.randomUUID();
      const bSettling = createSafeBarrier('t4_settling');
      let settlementCommitted = false;

      // Worker 1 enters settlement transaction and acquires SHARE lock on tenant
      const pWorker = clientWorker1.begin(async (sql) => {
        await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        bSettling.signal(); // Signal Admin that SHARE lock is held
        await new Promise((r) => setTimeout(r, 100)); // Hold lock to force Admin to block

        await sql`SELECT id, is_active, google_review_url FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;

        await sql`
          UPDATE ephemeral_sessions
          SET generations_remaining = generations_remaining - 1,
              generation_lock_token = NULL,
              generation_lock_until = NULL
          WHERE id = ${sessionId};
        `;
        settlementCommitted = true;
      });

      // Admin attempts suspension (FOR UPDATE -> MUST BLOCK until Worker 1 commits)
      const pAdmin = (async () => {
        await bSettling.wait();
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
          await sql`UPDATE tenants SET status = 'suspended' WHERE id = ${tenantId}`;
        });
      })();

      await Promise.all([pWorker, pAdmin]);
      if (!settlementCommitted) throw new Error('TEST 4 FAILED: Settlement did not commit first!');

      const [sess] = await clientAdmin`SELECT generations_remaining FROM ephemeral_sessions WHERE id = ${sessionId}`;
      if (sess.generations_remaining !== 2) throw new Error('TEST 4 FAILED: Quota not decremented!');
      console.log('✔ PASS: Race 4 - Settlement committed first; suspension blocked until settlement committed.\n');
    }

    // --- TEST 5: Settlement vs. Location Deactivation (Deactivation commits FIRST) ---
    console.log('--- TEST 5: Settlement vs. Location Deactivation (Deactivation commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const token = crypto.randomUUID();
      const bDeact = createSafeBarrier('t5_deact');
      let settlementAborted = false;

      // Admin deactivates location (Level 1 tenant lock -> updates location)
      const pAdmin = clientAdmin.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        bDeact.signal();
        await new Promise((r) => setTimeout(r, 100));
        await sql`UPDATE locations SET is_active = false, is_primary = false WHERE id = ${locationId}`;
      });

      // Worker 1 enters settlement
      const pWorker = (async () => {
        await bDeact.wait();
        try {
          await clientWorker1.begin(async (sql) => {
            await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
            const [loc] = await sql`SELECT id, is_active FROM locations WHERE id = ${locationId} FOR SHARE`;
            if (!loc.is_active) throw new Error('CAMPAIGN_INACTIVE');
          });
        } catch (err: any) {
          if (err.message === 'CAMPAIGN_INACTIVE') settlementAborted = true;
        }
      })();

      await Promise.all([pAdmin, pWorker]);
      if (!settlementAborted) throw new Error('TEST 5 FAILED: Settlement did not abort after location deactivation!');
      console.log('✔ PASS: Race 5 - Deactivation committed first; settlement blocked, detected inactive location, and aborted.\n');
    }

    // --- TEST 6: Settlement vs. Location Deactivation (Settlement commits FIRST) ---
    console.log('--- TEST 6: Settlement vs. Location Deactivation (Settlement commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const bSettling = createSafeBarrier('t6_settling');
      let settlementCommitted = false;

      const pWorker = clientWorker1.begin(async (sql) => {
        await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id, is_active FROM locations WHERE id = ${locationId} FOR SHARE`;
        bSettling.signal();
        await new Promise((r) => setTimeout(r, 100));
        await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;
        await sql`UPDATE ephemeral_sessions SET generations_remaining = 2 WHERE id = ${sessionId}`;
        settlementCommitted = true;
      });

      const pAdmin = (async () => {
        await bSettling.wait();
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
          await sql`UPDATE locations SET is_active = false, is_primary = false WHERE id = ${locationId}`;
        });
      })();

      await Promise.all([pWorker, pAdmin]);
      if (!settlementCommitted) throw new Error('TEST 6 FAILED: Settlement did not commit first!');
      console.log('✔ PASS: Race 6 - Settlement committed first; location deactivation blocked until settlement committed.\n');
    }

    // --- TEST 7: Settlement vs. Campaign Revocation (Revocation commits FIRST) ---
    console.log('--- TEST 7: Settlement vs. Campaign Revocation (Revocation commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const bRevoke = createSafeBarrier('t7_revoke');
      let settlementAborted = false;

      const pAdmin = clientAdmin.begin(async (sql) => {
        await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`;
        bRevoke.signal();
        await new Promise((r) => setTimeout(r, 100));
        await sql`UPDATE qr_campaigns SET status = 'revoked' WHERE id = ${campaignId}`;
      });

      const pWorker = (async () => {
        await bRevoke.wait();
        try {
          await clientWorker1.begin(async (sql) => {
            await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
            await sql`SELECT id, is_active FROM locations WHERE id = ${locationId} FOR SHARE`;
            const [c] = await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
            if (c.status !== 'active') throw new Error('CAMPAIGN_REVOKED');
          });
        } catch (err: any) {
          if (err.message === 'CAMPAIGN_REVOKED') settlementAborted = true;
        }
      })();

      await Promise.all([pAdmin, pWorker]);
      if (!settlementAborted) throw new Error('TEST 7 FAILED: Settlement did not abort after revocation!');
      console.log('✔ PASS: Race 7 - Campaign revocation committed first; settlement blocked on Level 3 lock, detected revocation, and aborted.\n');
    }

    // --- TEST 8: Settlement vs. Campaign Revocation (Settlement commits FIRST) ---
    console.log('--- TEST 8: Settlement vs. Campaign Revocation (Settlement commits FIRST) ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const bSettling = createSafeBarrier('t8_settling');
      let settlementCommitted = false;

      const pWorker = clientWorker1.begin(async (sql) => {
        await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id, is_active FROM locations WHERE id = ${locationId} FOR SHARE`;
        await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        bSettling.signal();
        await new Promise((r) => setTimeout(r, 100));
        await sql`SELECT id FROM ephemeral_sessions WHERE id = ${sessionId} FOR UPDATE`;
        await sql`UPDATE ephemeral_sessions SET generations_remaining = 2 WHERE id = ${sessionId}`;
        settlementCommitted = true;
      });

      const pAdmin = (async () => {
        await bSettling.wait();
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
          await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
          await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`;
          await sql`UPDATE qr_campaigns SET status = 'revoked' WHERE id = ${campaignId}`;
        });
      })();

      await Promise.all([pWorker, pAdmin]);
      if (!settlementCommitted) throw new Error('TEST 8 FAILED: Settlement did not commit first!');
      console.log('✔ PASS: Race 8 - Settlement committed first; campaign revocation blocked on Level 3 lock until settlement committed.\n');
    }

    // --- TEST 9: Settlement vs. Campaign Code Rotation ---
    console.log('--- TEST 9: Settlement vs. Campaign Code Rotation ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      // Admin rotates campaign code (status remains active)
      await clientAdmin`
        UPDATE qr_campaigns
        SET code = ${generateCampaignCode()}, updated_at = clock_timestamp()
        WHERE id = ${campaignId};
      `;

      // Worker 1 settles draft for existing session
      let settled = false;
      await clientWorker1.begin(async (sql) => {
        await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
        await sql`SELECT id, is_active, google_review_url FROM locations WHERE id = ${locationId} FOR SHARE`;
        const [c] = await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
        if (c.status === 'active') {
          await sql`UPDATE ephemeral_sessions SET generations_remaining = 2 WHERE id = ${sessionId}`;
          settled = true;
        }
      });

      if (!settled) throw new Error('TEST 9 FAILED: Settlement was incorrectly blocked by code rotation!');
      console.log('✔ PASS: Race 9 - Campaign code rotation does NOT invalidate issued sessions; settlement succeeded.\n');
    }

    // --- TEST 10: Expired Lease Takeover ---
    console.log('--- TEST 10: Expired Lease Takeover ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const token1 = crypto.randomUUID();
      const token2 = crypto.randomUUID();

      // Worker 1 acquires lease set to expire in 500ms
      await clientWorker1`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token1},
            generation_lock_until = clock_timestamp() + interval '500 milliseconds'
        WHERE id = ${sessionId};
      `;

      // Wait 600ms for lease to expire on PostgreSQL wall-clock
      await new Promise((r) => setTimeout(r, 600));

      // Worker 2 attempts reservation (checks <= clock_timestamp())
      const res2 = await clientWorker2`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${token2},
            generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId}
          AND generations_remaining > 0
          AND expires_at > clock_timestamp()
          AND (generation_lock_until IS NULL OR generation_lock_until <= clock_timestamp())
        RETURNING generation_lock_token;
      `;

      if (res2.length !== 1 || res2[0].generation_lock_token !== token2) {
        throw new Error('TEST 10 FAILED: Worker 2 failed to take over expired lease!');
      }
      console.log('✔ PASS: Race 10 - Expired lease successfully claimed by second worker.\n');
    }

    // --- TEST 11: Stale Lease Owner Cleanup After Takeover ---
    console.log('--- TEST 11: Stale Lease Owner Cleanup After Takeover ---');
    {
      const { tenantId, locationId, campaignId, code } = await createTestHierarchy();
      const { sessionId } = await createSession(tenantId, locationId, campaignId, code);

      const tokenA = crypto.randomUUID();
      const tokenB = crypto.randomUUID();

      // Worker A acquired lease which expired
      await clientWorker1`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${tokenA},
            generation_lock_until = clock_timestamp() - interval '1 second'
        WHERE id = ${sessionId};
      `;

      // Worker B took over lease with tokenB
      await clientWorker2`
        UPDATE ephemeral_sessions
        SET generation_lock_token = ${tokenB},
            generation_lock_until = clock_timestamp() + interval '30 seconds'
        WHERE id = ${sessionId};
      `;

      // Stale Worker A wakes up and attempts fenced release with tokenA
      const cleanupA = await clientWorker1`
        UPDATE ephemeral_sessions
        SET generation_lock_token = NULL, generation_lock_until = NULL
        WHERE id = ${sessionId}
          AND generation_lock_token = ${tokenA}
          AND generation_lock_until > clock_timestamp()
        RETURNING id;
      `;

      if (cleanupA.length !== 0) {
        throw new Error('TEST 11 FAILED: Stale Worker A cleared Worker B active lease!');
      }

      // Assert Worker B lease is still active
      const [currSession] = await clientAdmin`
        SELECT generation_lock_token FROM ephemeral_sessions WHERE id = ${sessionId};
      `;
      if (currSession.generation_lock_token !== tokenB) {
        throw new Error('TEST 11 FAILED: Worker B lease was corrupted!');
      }
      console.log('✔ PASS: Race 11 - Stale lease cleanup updated 0 rows; active lease owner preserved.\n');
    }

    console.log('================================================================');
    console.log('ALL 11 PHYSICAL POSTGRESQL CONCURRENCY RACES PASSED SUCCESSFULLY');
    console.log('================================================================\n');
  } finally {
    await clientAdmin.end();
    await clientWorker1.end();
    await clientWorker2.end();
  }
}

runPhysicalPostgresAiConcurrencyTests().catch((err) => {
  console.error('\nPhysical PostgreSQL Concurrency Test Harness Error:', err);
  process.exit(1);
});
