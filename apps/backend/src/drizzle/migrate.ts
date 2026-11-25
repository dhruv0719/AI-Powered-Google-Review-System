import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { createDatabase, getPGliteClient } from '../db/index.js';
import { getEnv } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../drizzle/migrations');

// Unique 64-bit integer advisory lock key for application migrations
const MIGRATION_ADVISORY_LOCK_ID = '847291048201948';

export async function runMigrations(customDb?: any) {
  const env = getEnv();

  if (env.DATABASE_URL && !customDb) {
    // Dedicated single connection for PostgreSQL migration serialization.
    // Acquiring and releasing pg_advisory_lock on the exact same dedicated connection (max: 1)
    // guarantees that connection pooling cannot release or orphan the lock on another connection.
    const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
    try {
      // 1. Acquire session-level advisory lock on dedicated connection
      await migrationClient`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID}::bigint)`;
      try {
        const migrationDb = drizzlePg(migrationClient);
        await migratePg(migrationDb, { migrationsFolder });
      } finally {
        // 2. Release session-level advisory lock on the exact same connection
        await migrationClient`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID}::bigint)`.catch(() => {});
      }
    } finally {
      // 3. Gracefully close dedicated migration connection
      await migrationClient.end({ timeout: 5 }).catch(() => {});
    }
  } else {
    // Custom DB or in-memory PGlite path
    const db = customDb || createDatabase();
    if (env.DATABASE_URL) {
      await migratePg(db, { migrationsFolder });
    } else {
      await migratePglite(db, { migrationsFolder });
    }
  }
}

// Direct execution entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
