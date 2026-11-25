import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/server.js';
import { getDb, createDatabase, closeDatabase, setTestDb } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

describe('Phase 8.2 Operational Readiness: Health & Readiness Endpoints', () => {
  it('GET /health succeeds (200) regardless of database state (liveness only)', async () => {
    const server = buildServer();

    // Even if db is temporarily null or broken, liveness returns ok
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /ready returns 200 when database connectivity is healthy', async () => {
    const server = buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.database).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /ready returns 503 without leaking stack or credentials when database fails', async () => {
    const server = buildServer();

    // Mock db to throw error simulating database failure
    const mockDb = {
      execute: vi.fn().mockRejectedValue(new Error('Connection refused: postgresql://secret:pass@internal-db:5432')),
    };
    setTestDb(mockDb as any);

    try {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('not_ready');
      expect(body.database).toBe('disconnected');
      expect(body.timestamp).toBeDefined();

      // Ensure no raw error, password, or connection string is leaked in the public response
      expect(response.body).not.toContain('secret');
      expect(response.body).not.toContain('pass');
      expect(response.body).not.toContain('postgresql');
      expect(response.body).not.toContain('internal-db');
    } finally {
      // Restore valid database instance
      setTestDb(createDatabase());
    }
  });
});

describe('Phase 8.2 Operational Readiness: Database Lifecycle & Graceful Shutdown', () => {
  beforeEach(() => {
    setTestDb(createDatabase());
  });

  afterEach(async () => {
    await closeDatabase();
    setTestDb(createDatabase());
  });

  it('closeDatabase closes active client cleanly', async () => {
    const db = getDb();
    expect(db).toBeDefined();

    await expect(closeDatabase()).resolves.toBeUndefined();
  });

  it('closeDatabase is idempotent and safe when called repeatedly', async () => {
    // Call 1: cleans up active instances
    await expect(closeDatabase()).resolves.toBeUndefined();

    // Call 2: already closed, should be a safe no-op
    await expect(closeDatabase()).resolves.toBeUndefined();

    // Call 3: still safe
    await expect(closeDatabase()).resolves.toBeUndefined();
  });

  it('safely re-initializes database after closeDatabase if getDb is called again', async () => {
    await closeDatabase();

    const newDb = getDb();
    expect(newDb).toBeDefined();

    const result = await newDb.execute(sql`SELECT 1 as num`);
    expect(result).toBeDefined();

    await closeDatabase();
  });
});
