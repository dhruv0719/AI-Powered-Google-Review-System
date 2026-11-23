import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { getEnv } from '../config/env.js';

export type AppDatabase = ReturnType<typeof createDatabase>;

let dbInstance: AppDatabase | null = null;
let pgliteInstance: PGlite | null = null;

export function createDatabase(connectionString?: string) {
  const env = getEnv();
  const url = connectionString || env.DATABASE_URL;

  if (url) {
    const client = postgres(url, { max: 10 });
    return drizzlePg(client, { schema });
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
