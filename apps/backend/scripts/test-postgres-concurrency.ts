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
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';
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

    // Setup isolated test tenant, location, campaign
    const tenantId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const initialCode = generateCampaignCode();

    await clientAdmin`
      INSERT INTO tenants (id, display_name, slug, status)
      VALUES (${tenantId}, 'Concurrency Dental', ${'dentist-' + Date.now()}, 'active');
    `;
    await clientAdmin`
      INSERT INTO locations (id, tenant_id, name, google_review_url, is_primary, is_active)
      VALUES (${locationId}, ${tenantId}, 'Main Office', 'https://g.page/r/concurrency/review', true, true);
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
      if (customerAborted && fbCount.count === 0) {
        console.log('✔ PASS: Customer detected deactivated location after unblocking and aborted. Zero rows inserted.\n');
      } else {
        throw new Error(`Race 4 Failed: customerAborted=${customerAborted}, count=${fbCount.count}`);
      }

      // Reset location to active for next test
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
    }

    console.log('ALL 5 DETERMINISTIC POSTGRESQL CONCURRENCY RACES COMPLETED SUCCESSFULLY.');
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
