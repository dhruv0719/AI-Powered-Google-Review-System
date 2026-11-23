import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../src/drizzle/schema.js';
import { setTestDb } from '../src/db/index.js';
import { buildServer, BuildServerOptions } from '../src/server.js';
import { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../drizzle/migrations');

export async function createTestApp(options?: BuildServerOptions): Promise<{ app: FastifyInstance; db: ReturnType<typeof drizzle> }> {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-secret-at-least-32-characters-long-1234!';

  // In-memory fresh PGlite instance for each test suite
  const client = new PGlite();
  const db = drizzle(client, { schema });

  // Run real Drizzle SQL migrations
  await migrate(db, { migrationsFolder });

  setTestDb(db as any);

  const app = buildServer(options);
  await app.ready();

  return { app, db };
}
