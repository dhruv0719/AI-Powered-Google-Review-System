import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const executedQueries: string[] = [];
let capturedUrl: string | null = null;
let capturedOptions: any = null;
let clientEnded = false;

const mockSql: any = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: any[]) => {
  const query = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? String(values[i]) : ''), '');
  executedQueries.push(query);
  return [];
});
mockSql.end = vi.fn().mockImplementation(async () => {
  clientEnded = true;
});

vi.mock('postgres', () => {
  return {
    default: (url: string, opts: any) => {
      capturedUrl = url;
      capturedOptions = opts;
      return mockSql;
    },
  };
});

let migratePgCalled = false;
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));
vi.mock('drizzle-orm/postgres-js/migrator', () => {
  return {
    migrate: vi.fn().mockImplementation(async () => {
      migratePgCalled = true;
    }),
  };
});

import { runMigrations } from '../src/drizzle/migrate.js';
import { resetEnv } from '../src/config/env.js';

describe('Migration Direct Connection & Advisory Lock Verification', () => {
  const originalEnv = { ...process.env };
  const POOLED_URL = 'postgresql://user:pass@ep-pool-123-pooler.us-east-2.aws.neon.tech/neondb';
  const DIRECT_URL = 'postgresql://user:pass@ep-pool-123.us-east-2.aws.neon.tech/neondb';

  beforeEach(() => {
    executedQueries.length = 0;
    capturedUrl = null;
    capturedOptions = null;
    clientEnded = false;
    migratePgCalled = false;
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  it('1. executes migrations on direct MIGRATION_DATABASE_URL with max: 1 connection', async () => {
    process.env.DATABASE_URL = POOLED_URL;
    process.env.MIGRATION_DATABASE_URL = DIRECT_URL;
    resetEnv();

    await runMigrations();

    // Verify it connected to the direct migration URL, NOT the pooled runtime URL
    expect(capturedUrl).toBe(DIRECT_URL);
    expect(capturedUrl).not.toBe(POOLED_URL);
    expect(capturedOptions).toEqual({ max: 1 });
  });

  it('2. acquires session-level advisory lock before migrating and unlocks in finally', async () => {
    process.env.DATABASE_URL = POOLED_URL;
    process.env.MIGRATION_DATABASE_URL = DIRECT_URL;
    resetEnv();

    await runMigrations();

    expect(migratePgCalled).toBe(true);

    // Verify lock acquired before migration, unlocked after migration
    expect(executedQueries.length).toBe(2);
    expect(executedQueries[0]).toContain('pg_advisory_lock(847291048201948::bigint)');
    expect(executedQueries[1]).toContain('pg_advisory_unlock(847291048201948::bigint)');

    // Verify connection ended cleanly
    expect(clientEnded).toBe(true);
    expect(mockSql.end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
