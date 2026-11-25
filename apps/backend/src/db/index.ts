import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { getEnv } from '../config/env.js';

export type AppDatabase = ReturnType<typeof createDatabase>;

let dbInstance: AppDatabase | null = null;
let pgliteInstance: PGlite | null = null;
let pgClientInstance: ReturnType<typeof postgres> | null = null;

export function createDatabase(connectionString?: string) {
  const env = getEnv();
  const url = connectionString || env.DATABASE_URL;

  if (url) {
    if (!pgClientInstance) {
      pgClientInstance = postgres(url, { max: 10 });
    }
    return drizzlePg(pgClientInstance, { schema });
  }

  // Fallback to in-memory PGlite for local testing
  if (!pgliteInstance) {
    pgliteInstance = new PGlite();
  }
  return drizzlePglite(pgliteInstance, { schema });
}

export function getDb(): AppDatabase {
  if (!dbInstance) {
    dbInstance = createDatabase();
  }
  return dbInstance;
}

export function setTestDb(db: AppDatabase) {
  dbInstance = db;
}

export function getPGliteClient(): PGlite | null {
  return pgliteInstance;
}

export function getPostgresClient(): ReturnType<typeof postgres> | null {
  return pgClientInstance;
}

/**
 * Gracefully terminates active database connections.
 * Safe and idempotent: can be called repeatedly without throwing.
 */
export async function closeDatabase(): Promise<void> {
  if (pgClientInstance) {
    const client = pgClientInstance;
    pgClientInstance = null;
    dbInstance = null;
    await client.end({ timeout: 5 });
  }

  if (pgliteInstance) {
    const client = pgliteInstance;
    pgliteInstance = null;
    dbInstance = null;
    await client.close();
  }
}
