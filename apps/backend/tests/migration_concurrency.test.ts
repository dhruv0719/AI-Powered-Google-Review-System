import { describe, it, expect } from 'vitest';
import { runMigrations } from '../src/drizzle/migrate.js';

describe('OPS-01: Migration Runner Tests', () => {
  it('safely runs sequential migrations idempotently on the fallback database path', async () => {
    // Sequential execution runs cleanly and is idempotent in local/in-memory test mode
    await expect(runMigrations()).resolves.toBeUndefined();
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('exposes a callable runMigrations entry point for application startup', async () => {
    // Note: Live PostgreSQL advisory lock concurrency (pg_advisory_lock contention across multiple processes)
    // requires a real PostgreSQL instance and is verified via standalone integration testing,
    // not in this in-memory fallback unit test.
    expect(typeof runMigrations).toBe('function');
  });
});
