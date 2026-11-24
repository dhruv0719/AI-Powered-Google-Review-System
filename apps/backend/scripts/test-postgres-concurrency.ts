/**
 * Deterministic PostgreSQL Multi-Connection Concurrency Test Harness
 * 
 * Demonstrates transactional ordering and mutual exclusion across real PostgreSQL
 * backend worker processes using independent physical TCP connections and synchronization barriers.
 * 
 * Races Demonstrated:
 * 1. Duplicate Feedback Submission (Two concurrent submissions on the same session token)
 * 2. Customer Submission vs. Campaign Rotation (In-flight customer feedback during code rotation)
 * 3. Customer Submission vs. Campaign Revocation (Feedback submission racing with campaign revocation)
 * 4. Customer Submission vs. Location Deactivation (Feedback submission racing with location deactivation)
 * 5. Customer Submission vs. Tenant Suspension (Feedback submission racing with tenant suspension)
 */

import postgres from 'postgres';
import { generateSessionToken, hashSessionToken, computePayloadFingerprint } from '../src/utils/crypto.js';
import { generateCampaignCode } from '../src/utils/qr.js';

interface Barrier {
  wait: () => Promise<void>;
  signal: () => void;
}

function createBarrier(): Barrier {
  let resolvePromise: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    wait: () => promise,
    signal: () => resolvePromise(),
  };
}

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

interface Rendezvous {
  arrive: () => Promise<void>;
  abort: (err: Error) => void;
}

function createRendezvous(expectedCount = 2, timeoutMs = 10000): Rendezvous {
  let arrived = 0;
  let resolvePromise: () => void;
  let rejectPromise: (err: Error) => void;
  let timer: NodeJS.Timeout;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timer = setTimeout(() => {
      reject(new Error(`Rendezvous timed out after ${timeoutMs}ms waiting for ${expectedCount} parties (arrived: ${arrived})`));
    }, timeoutMs);
  });

  return {
    arrive: async () => {
      arrived++;
      if (arrived === expectedCount) {
        clearTimeout(timer);
        resolvePromise();
      }
      return promise;
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

async function runDeterministicPostgresConcurrencyTests() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.log('\n[SKIP] DATABASE_URL is not set. Deterministic real PostgreSQL tests require a running PostgreSQL instance.');
    console.log('Usage: DATABASE_URL=postgres://user:pass@localhost:5432/review_system_test npx tsx scripts/test-postgres-concurrency.ts\n');
    process.exit(0);
  }

  console.log('Connecting to PostgreSQL via multiple physical connections...');
  // Initialize distinct single-connection clients to simulate independent OS-level PostgreSQL backend workers
  const clientAdmin = postgres(dbUrl, { max: 1 });
  const clientUser1 = postgres(dbUrl, { max: 1 });
  const clientUser2 = postgres(dbUrl, { max: 1 });

  try {
    // 0. Verify connection
    await clientAdmin`SELECT 1`;
    console.log('PostgreSQL connection established successfully.\n');

    // Setup isolated test tenant, locations (HQ primary + Branch secondary), campaign
    const tenantId = crypto.randomUUID();
    const primaryLocationId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const initialCode = generateCampaignCode();

    await clientAdmin`
      INSERT INTO tenants (id, display_name, slug, status)
      VALUES (${tenantId}, 'Concurrency Dental', ${'dentist-' + Date.now()}, 'active');
    `;
    await clientAdmin`
      INSERT INTO locations (id, tenant_id, name, google_review_url, is_primary, is_active)
      VALUES (${primaryLocationId}, ${tenantId}, 'HQ Office', 'https://g.page/r/concurrency/review', true, true);
    `;
    await clientAdmin`
      INSERT INTO locations (id, tenant_id, name, google_review_url, is_primary, is_active)
      VALUES (${locationId}, ${tenantId}, 'Branch Office', 'https://g.page/r/concurrency/review', false, true);
    `;
    await clientAdmin`
      INSERT INTO qr_campaigns (id, tenant_id, location_id, name, code, status)
      VALUES (${campaignId}, ${tenantId}, ${locationId}, 'Concurr Campaign', ${initialCode}, 'active');
    `;

    console.log('--- TEST 1: Duplicate Feedback Submission Race ---');
    {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${initialCode}, NOW() + INTERVAL '15 minutes');
      `;

      const b1 = createBarrier();
      let winnerCommitted = false;
      let loserRejected = false;

      // Connection 1 attempts submission
      const tx1 = (async () => {
        await clientUser1.begin(async (sql) => {
          // Lock session row
          const [sess] = await sql`SELECT id, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
          b1.signal(); // Signal Connection 2 that lock is held

          // Artificial delay while holding lock to force Connection 2 to block in kernel
          await new Promise((r) => setTimeout(r, 100));

          if (!sess.feedback_submitted_at) {
            await sql`
              INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
              VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sess.id}, 5, 'First submitter', true, 'new')
            `;
            await sql`UPDATE ephemeral_sessions SET feedback_submitted_at = NOW() WHERE id = ${sess.id}`;
            winnerCommitted = true;
          }
        });
      })();

      // Connection 2 attempts simultaneous submission with same session token
      const tx2 = (async () => {
        await b1.wait(); // Wait until Connection 1 has locked the row
        await clientUser2.begin(async (sql) => {
          // This call blocks until Connection 1 commits
          const [sess] = await sql`SELECT id, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
          if (sess.feedback_submitted_at) {
            loserRejected = true; // Correctly rejected!
            return;
          }
          await sql`
            INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
            VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sess.id}, 1, 'Duplicate submitter', true, 'new')
          `;
        });
      })();

      await Promise.all([tx1, tx2]);

      const [fbCount] = await clientAdmin`SELECT COUNT(*)::int as count FROM private_feedback WHERE session_id = ${sessionId}`;
      if (winnerCommitted && loserRejected && fbCount.count === 1) {
        console.log('✔ PASS: Exactly one feedback record committed. Loser detected submission and rejected cleanly.\n');
      } else {
        throw new Error(`Race 1 Failed: count=${fbCount.count}, winner=${winnerCommitted}, loserRejected=${loserRejected}`);
      }
    }

    console.log('--- TEST 2: Customer Submission vs. Campaign Rotation ---');
    {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${initialCode}, NOW() + INTERVAL '15 minutes');
      `;

      // Admin rotates campaign code to new code
      const newCode = generateCampaignCode();
      await clientAdmin`UPDATE qr_campaigns SET code = ${newCode}, updated_at = NOW() WHERE id = ${campaignId}`;

      // Customer submits feedback using their issued token under old code
      let customerSubmitted = false;
      await clientUser1.begin(async (sql) => {
        const [sess] = await sql`SELECT id, issued_code, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
        const [camp] = await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;

        // Invariant: If campaign is still 'active', customer submission with valid issued session succeeds
        if (camp.status === 'active' && !sess.feedback_submitted_at) {
          await sql`
            INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
            VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sess.id}, 4, 'Submitted after rotation', true, 'new')
          `;
          await sql`UPDATE ephemeral_sessions SET feedback_submitted_at = NOW() WHERE id = ${sess.id}`;
          customerSubmitted = true;
        }
      });

      if (customerSubmitted) {
        console.log('✔ PASS: In-flight customer session with valid issued code committed successfully after rotation.\n');
      } else {
        throw new Error('Race 2 Failed: Customer submission was prematurely rejected after code rotation.');
      }
    }

    console.log('--- TEST 3: Customer Submission vs. Campaign Revocation ---');
    {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${initialCode}, NOW() + INTERVAL '15 minutes');
      `;

      const b3 = createBarrier();
      let customerAborted = false;

      // Admin begins revocation transaction
      const txRevoke = (async () => {
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`;
          b3.signal();
          await new Promise((r) => setTimeout(r, 100));
          await sql`UPDATE qr_campaigns SET status = 'revoked', updated_at = NOW() WHERE id = ${campaignId}`;
        });
      })();

      // Customer begins submission transaction concurrently
      const txSubmit = (async () => {
        await b3.wait();
        await clientUser1.begin(async (sql) => {
          await sql`SELECT id FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
          // This FOR SHARE blocks until txRevoke commits
          const [camp] = await sql`SELECT id, status FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;
          if (camp.status !== 'active') {
            customerAborted = true;
            return; // Abort
          }
          await sql`
            INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
            VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sessionId}, 5, 'Late submit', true, 'new')
          `;
        });
      })();

      await Promise.all([txRevoke, txSubmit]);

      const [fbCount] = await clientAdmin`SELECT COUNT(*)::int as count FROM private_feedback WHERE session_id = ${sessionId}`;
      if (customerAborted && fbCount.count === 0) {
        console.log('✔ PASS: Customer detected revoked campaign after unblocking and aborted. Zero rows inserted.\n');
      } else {
        throw new Error(`Race 3 Failed: customerAborted=${customerAborted}, count=${fbCount.count}`);
      }

      // Reset campaign to active for next test
      await clientAdmin`UPDATE qr_campaigns SET status = 'active' WHERE id = ${campaignId}`;
    }

    console.log('--- TEST 4: Customer Submission vs. Location Deactivation ---');
    {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${initialCode}, NOW() + INTERVAL '15 minutes');
      `;

      const b4 = createBarrier();
      let customerAborted = false;

      // Admin begins location deactivation
      const txDeactivate = (async () => {
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM locations WHERE id = ${locationId} FOR UPDATE`;
          b4.signal();
          await new Promise((r) => setTimeout(r, 100));
          await sql`UPDATE locations SET is_active = false, updated_at = NOW() WHERE id = ${locationId}`;
        });
      })();

      // Customer attempts submission
      const txSubmit = (async () => {
        await b4.wait();
        await clientUser1.begin(async (sql) => {
          await sql`SELECT id FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
          // FOR SHARE blocks until txDeactivate commits
          const [loc] = await sql`SELECT id, is_active FROM locations WHERE id = ${locationId} FOR SHARE`;
          if (!loc.is_active) {
            customerAborted = true;
            return;
          }
          await sql`
            INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
            VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sessionId}, 5, 'Late submit', true, 'new')
          `;
        });
      })();

      await Promise.all([txDeactivate, txSubmit]);

      const [fbCount] = await clientAdmin`SELECT COUNT(*)::int as count FROM private_feedback WHERE session_id = ${sessionId}`;
      const [hqLoc] = await clientAdmin`SELECT is_primary, is_active FROM locations WHERE id = ${primaryLocationId}`;
      const [branchLoc] = await clientAdmin`SELECT is_primary, is_active FROM locations WHERE id = ${locationId}`;

      if (customerAborted && fbCount.count === 0 && hqLoc?.is_primary && hqLoc?.is_active && !branchLoc?.is_active && !branchLoc?.is_primary) {
        console.log('✔ PASS: Customer detected deactivated branch location after unblocking and aborted. HQ remains active and primary.\n');
      } else {
        throw new Error(`Race 4 Failed: customerAborted=${customerAborted}, count=${fbCount.count}, hqPrimary=${hqLoc?.is_primary}, branchActive=${branchLoc?.is_active}`);
      }

      // Reset branch location to active for next test
      await clientAdmin`UPDATE locations SET is_active = true WHERE id = ${locationId}`;
    }

    console.log('--- TEST 5: Customer Submission vs. Tenant Suspension ---');
    {
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash}, ${initialCode}, NOW() + INTERVAL '15 minutes');
      `;

      const b5 = createBarrier();
      let customerAborted = false;

      // Platform admin begins tenant suspension
      const txSuspend = (async () => {
        await clientAdmin.begin(async (sql) => {
          await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
          b5.signal();
          await new Promise((r) => setTimeout(r, 100));
          await sql`UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = ${tenantId}`;
        });
      })();

      // Customer attempts submission
      const txSubmit = (async () => {
        await b5.wait();
        await clientUser1.begin(async (sql) => {
          await sql`SELECT id FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
          // FOR SHARE on tenants blocks until txSuspend commits
          const [t] = await sql`SELECT id, status FROM tenants WHERE id = ${tenantId} FOR SHARE`;
          if (t.status !== 'active') {
            customerAborted = true;
            return;
          }
          await sql`
            INSERT INTO private_feedback (id, tenant_id, location_id, campaign_id, session_id, rating, feedback_text, consent_given, status)
            VALUES (${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sessionId}, 5, 'Late submit', true, 'new')
          `;
        });
      })();

      await Promise.all([txSuspend, txSubmit]);

      const [fbCount] = await clientAdmin`SELECT COUNT(*)::int as count FROM private_feedback WHERE session_id = ${sessionId}`;
      if (customerAborted && fbCount.count === 0) {
        console.log('✔ PASS: Customer detected suspended tenant after unblocking and aborted. Feedback CANNOT commit after suspension commits!\n');
      } else {
        throw new Error(`Race 5 Failed: customerAborted=${customerAborted}, count=${fbCount.count}`);
      }
      // Reset tenant to active and independently verify restoration
      await clientAdmin`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = ${tenantId}`;
      const [restoredTenant] = await clientAdmin`SELECT status FROM tenants WHERE id = ${tenantId}`;
      if (restoredTenant.status !== 'active') {
        throw new Error(`Test 5 Cleanup Failed: Tenant was not restored to active status (status=${restoredTenant.status})`);
      }
    }

    console.log('--- TEST 6: Cross-Session Idempotency Race (Identical Submission ID) ---');
    {
      // 0. Confirm pre-state fixtures are valid and active
      const [currTenant] = await clientAdmin`SELECT status FROM tenants WHERE id = ${tenantId}`;
      const [currLoc] = await clientAdmin`SELECT is_active, is_primary FROM locations WHERE id = ${locationId}`;
      const [currCamp] = await clientAdmin`SELECT status FROM qr_campaigns WHERE id = ${campaignId}`;
      if (currTenant.status !== 'active' || !currLoc.is_active || currCamp.status !== 'active') {
        throw new Error(`Test 6 Pre-State Invalid: tenant=${currTenant.status}, branchActive=${currLoc.is_active}, campaign=${currCamp.status}`);
      }

      // 1. Create service fixture for snapshot verification
      const serviceId = crypto.randomUUID();
      await clientAdmin`
        INSERT INTO services (id, tenant_id, location_id, name, is_active)
        VALUES (${serviceId}, ${tenantId}, ${locationId}, 'General Consultation', true)
      `;

      // 2. Create two distinct ephemeral sessions
      const rawToken1 = generateSessionToken();
      const tokenHash1 = hashSessionToken(rawToken1);
      const sessionId1 = crypto.randomUUID();

      const rawToken2 = generateSessionToken();
      const tokenHash2 = hashSessionToken(rawToken2);
      const sessionId2 = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES 
          (${sessionId1}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash1}, ${initialCode}, NOW() + INTERVAL '15 minutes'),
          (${sessionId2}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash2}, ${initialCode}, NOW() + INTERVAL '15 minutes')
      `;

      const submissionId = `sub_cross_race_${Date.now()}`;
      const payload = {
        rating: 5,
        serviceIds: [serviceId],
        feedbackText: 'Physical PostgreSQL cross-session idempotency verification',
        customerContact: 'verified@customer.com',
        consentGiven: true,
        clientSubmissionId: submissionId,
      };
      // Canonical fingerprint using production normalization
      const expectedFingerprint = computePayloadFingerprint(payload);

      // Query Connection 2 backend PID for lock observability
      const [{ pid: pidUser2 }] = await clientUser2`SELECT pg_backend_pid()::int as pid`;

      // Synchronization primitives
      const bPreInsert = createRendezvous(2, 10000);
      const bWinnerInserted = createSafeBarrier('WinnerInserted', 10000);
      const bLockConfirmed = createSafeBarrier('LockConfirmed', 10000);

      let isAborted = false;
      let abortError: Error | null = null;

      const abortAll = (err: Error) => {
        if (!isAborted) {
          isAborted = true;
          abortError = err;
          bPreInsert.abort(err);
          bWinnerInserted.abort(err);
          bLockConfirmed.abort(err);
        }
      };

      const checkAborted = () => {
        if (isAborted) {
          throw abortError || new Error('Race aborted due to coordinator or task failure');
        }
      };

      let winnerInsertedRow: any = undefined;
      let winnerFeedbackId: string | null = null;
      let winnerIsReplay: boolean | null = null;

      let competingInsertedRow: any = undefined;
      let replayWinningRow: any = undefined;
      let replayFeedbackId: string | null = null;
      let replayIsReplay: boolean | null = null;

      // Connection 1: Winner task
      const tx1 = (async () => {
        try {
          await clientUser1.begin(async (sql) => {
            checkAborted();
            // Session lock
            const [sess] = await sql`SELECT id, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash1} FOR UPDATE`;
            if (sess.feedback_submitted_at) throw new Error('Session 1 already submitted');

            // Production pre-insert idempotency lookup
            const [existing] = await sql`
              SELECT id, payload_fingerprint FROM private_feedback 
              WHERE campaign_id = ${campaignId} AND client_submission_id = ${submissionId}
            `;
            if (existing) throw new Error('Session 1 unexpectedly found existing feedback during pre-insert check');

            // Hierarchical shared locks
            await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
            await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
            await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;

            // Both Connection 1 and Connection 2 must complete pre-insert lookup before either inserts
            await bPreInsert.arrive();
            checkAborted();

            // Insert winning row
            const [inserted] = await sql`
              INSERT INTO private_feedback (
                id, tenant_id, location_id, campaign_id, session_id,
                rating, feedback_text, customer_contact, consent_given,
                status, client_submission_id, payload_fingerprint
              )
              VALUES (
                ${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sess.id},
                ${payload.rating}, ${payload.feedbackText}, ${payload.customerContact}, true,
                'new', ${submissionId}, ${expectedFingerprint}
              )
              ON CONFLICT DO NOTHING
              RETURNING id, client_submission_id, payload_fingerprint
            `;

            winnerInsertedRow = inserted;
            winnerFeedbackId = inserted?.id ?? null;
            winnerIsReplay = false;

            // Snapshot service association
            await sql`
              INSERT INTO private_feedback_services (feedback_id, service_id, tenant_id, location_id, service_name_snapshot)
              VALUES (${inserted.id}, ${serviceId}, ${tenantId}, ${locationId}, 'General Consultation')
            `;

            // Signal Connection 2 that winner has inserted (uncommitted)
            bWinnerInserted.signal();

            // Hold transaction open until clientAdmin confirms Connection 2 is genuinely locked in kernel
            await bLockConfirmed.wait();
            checkAborted();

            // Update Session 1 submitted timestamp and commit
            await sql`UPDATE ephemeral_sessions SET feedback_submitted_at = NOW() WHERE id = ${sess.id}`;
            checkAborted();
          });
        } catch (err: any) {
          abortAll(err);
          throw err;
        }
      })();

      // Connection 2: Loser / Replay task
      const tx2 = (async () => {
        try {
          await clientUser2.begin(async (sql) => {
            checkAborted();
            // Session lock
            const [sess] = await sql`SELECT id, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash2} FOR UPDATE`;
            if (sess.feedback_submitted_at) throw new Error('Session 2 already submitted');

            // Production pre-insert idempotency lookup
            const [existing] = await sql`
              SELECT id, payload_fingerprint FROM private_feedback 
              WHERE campaign_id = ${campaignId} AND client_submission_id = ${submissionId}
            `;
            if (existing) throw new Error('Session 2 unexpectedly found existing feedback during pre-insert check');

            // Hierarchical shared locks
            await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`;
            await sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`;
            await sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR SHARE`;

            // Both Connection 1 and Connection 2 must complete pre-insert lookup before either inserts
            await bPreInsert.arrive();
            checkAborted();

            // Await winner insertion
            await bWinnerInserted.wait();
            checkAborted();

            // Competing insert tagged with comment; blocks in PostgreSQL kernel until Connection 1 commits
            const [competing] = await sql`
              /* test6_conn2_competing_insert */
              INSERT INTO private_feedback (
                id, tenant_id, location_id, campaign_id, session_id,
                rating, feedback_text, customer_contact, consent_given,
                status, client_submission_id, payload_fingerprint
              )
              VALUES (
                ${crypto.randomUUID()}, ${tenantId}, ${locationId}, ${campaignId}, ${sess.id},
                ${payload.rating}, ${payload.feedbackText}, ${payload.customerContact}, true,
                'new', ${submissionId}, ${expectedFingerprint}
              )
              ON CONFLICT DO NOTHING
              RETURNING id, client_submission_id, payload_fingerprint
            `;

            // Detect if coordinator or Connection 1 failed while blocked; roll back if aborted
            checkAborted();

            competingInsertedRow = competing; // Undefined when suppressed by ON CONFLICT DO NOTHING

            if (!competing) {
              // Fallback query in READ COMMITTED mode sees committed Connection 1 row
              const [winningRow] = await sql`
                SELECT id, payload_fingerprint FROM private_feedback 
                WHERE campaign_id = ${campaignId} AND client_submission_id = ${submissionId}
              `;

              replayWinningRow = winningRow;
              if (winningRow && winningRow.payload_fingerprint === expectedFingerprint) {
                replayFeedbackId = winningRow.id;
                replayIsReplay = true;
                // Replay deliberately skips service insertion to prevent duplicates
                await sql`UPDATE ephemeral_sessions SET feedback_submitted_at = NOW() WHERE id = ${sess.id}`;
              }
            }
            checkAborted();
          });
        } catch (err: any) {
          abortAll(err);
          throw err;
        }
      })();

      // Coordinator: Verifies lock via pg_stat_activity
      const txWatch = (async () => {
        try {
          await bWinnerInserted.wait();
          checkAborted();
          await waitForBackendLock(clientAdmin, pidUser2, 'test6_conn2_competing_insert', 5000);
          bLockConfirmed.signal();
        } catch (err: any) {
          abortAll(err);
          throw err;
        }
      })();

      // Settle all tasks safely
      const settlements = await Promise.allSettled([tx1, tx2, txWatch]);
      const failures = settlements.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Race 6 Tasks Failed: ${failures.map((f) => f.reason?.message || String(f.reason)).join('; ')}`);
      }

      // Negative Invariant: Verify altered fingerprint rejection on existing submission ID
      const rawToken3 = generateSessionToken();
      const tokenHash3 = hashSessionToken(rawToken3);
      const sessionId3 = crypto.randomUUID();

      await clientAdmin`
        INSERT INTO ephemeral_sessions (id, tenant_id, location_id, campaign_id, token_hash, issued_code, expires_at)
        VALUES (${sessionId3}, ${tenantId}, ${locationId}, ${campaignId}, ${tokenHash3}, ${initialCode}, NOW() + INTERVAL '15 minutes')
      `;

      let tamperRejected = false;
      const tamperedPayload = { ...payload, rating: 1 };
      const tamperedFingerprint = computePayloadFingerprint(tamperedPayload);

      await clientUser1.begin(async (sql) => {
        const [sess] = await sql`SELECT id, feedback_submitted_at FROM ephemeral_sessions WHERE token_hash = ${tokenHash3} FOR UPDATE`;
        // Production pre-insert idempotency lookup
        const [existing] = await sql`
          SELECT id, payload_fingerprint FROM private_feedback 
          WHERE campaign_id = ${campaignId} AND client_submission_id = ${submissionId}
        `;

        if (existing) {
          if (existing.payload_fingerprint === tamperedFingerprint) {
            throw new Error('Negative Invariant Failed: Tampered fingerprint unexpectedly matched stored fingerprint');
          } else {
            // Production validation conflict path: reject submission and do NOT mark session submitted
            tamperRejected = true;
            return;
          }
        }
      });

      // Comprehensive Verification Assertions
      if (!winnerInsertedRow || !winnerInsertedRow.id) {
        throw new Error('Invariant 1 Failed: Connection 1 insert failed to return winning feedback record.');
      }
      if (competingInsertedRow !== undefined) {
        throw new Error('Invariant 2 Failed: Connection 2 competing insert returned a row instead of 0 rows (ON CONFLICT DO NOTHING did not suppress duplicate).');
      }
      if (!replayWinningRow || !replayWinningRow.id) {
        throw new Error('Invariant 3 Failed: Connection 2 replay lookup failed to find the committed winning row in READ COMMITTED mode.');
      }
      if (winnerFeedbackId !== replayFeedbackId) {
        throw new Error(`Invariant 4 Failed: Winner ID (${winnerFeedbackId}) does not match Replay ID (${replayFeedbackId}).`);
      }
      if (winnerIsReplay !== false || replayIsReplay !== true) {
        throw new Error(`Invariant 5 Failed: Classification mismatch (winnerIsReplay=${winnerIsReplay}, replayIsReplay=${replayIsReplay}).`);
      }

      const [fbRow] = await clientAdmin`
        SELECT COUNT(*)::int as count, MAX(payload_fingerprint) as fingerprint 
        FROM private_feedback 
        WHERE campaign_id = ${campaignId} AND client_submission_id = ${submissionId}
      `;
      if (fbRow.count !== 1) {
        throw new Error(`Invariant 6 Failed: Expected exactly 1 private_feedback row, found ${fbRow.count}.`);
      }
      if (fbRow.fingerprint !== expectedFingerprint) {
        throw new Error(`Invariant 7 Failed: Stored fingerprint ${fbRow.fingerprint} does not match expected canonical fingerprint ${expectedFingerprint}.`);
      }

      const [svcRow] = await clientAdmin`
        SELECT COUNT(*)::int as count FROM private_feedback_services 
        WHERE feedback_id = ${winnerFeedbackId}
      `;
      if (svcRow.count !== 1) {
        throw new Error(`Invariant 8 Failed: Expected exactly 1 service snapshot row, found ${svcRow.count} (duplicate created on replay!).`);
      }

      const [sessionRows] = await clientAdmin`
        SELECT COUNT(*)::int as count FROM ephemeral_sessions 
        WHERE id IN (${sessionId1}, ${sessionId2}) AND feedback_submitted_at IS NOT NULL
      `;
      if (sessionRows.count !== 2) {
        throw new Error(`Invariant 9 Failed: Expected both Session 1 and Session 2 to be marked submitted, found ${sessionRows.count}.`);
      }

      const [session3Row] = await clientAdmin`
        SELECT feedback_submitted_at FROM ephemeral_sessions WHERE id = ${sessionId3}
      `;
      if (!tamperRejected || session3Row.feedback_submitted_at !== null) {
        throw new Error('Invariant 10 Failed: Tampered fingerprint was not cleanly rejected, or Session 3 was marked submitted.');
      }

      console.log('✔ PASS: Deterministic lock wait confirmed via pg_stat_activity. Exactly 1 feedback row, 1 service snapshot, matching replay IDs, and tampered fingerprint rejected.\n');
    }

    console.log('ALL 6 DETERMINISTIC POSTGRESQL CONCURRENCY RACES COMPLETED SUCCESSFULLY.');
  } finally {
    await clientAdmin.end();
    await clientUser1.end();
    await clientUser2.end();
  }
}

runDeterministicPostgresConcurrencyTests().catch((err) => {
  console.error('PostgreSQL Concurrency Test Harness Error:', err);
  process.exit(1);
});
