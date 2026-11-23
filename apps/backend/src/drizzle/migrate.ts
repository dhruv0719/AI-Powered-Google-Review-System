import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDatabase, getPGliteClient } from '../db/index.js';
import { getEnv } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../drizzle/migrations');

export async function runMigrations(customDb?: any) {
  const env = getEnv();
  const db = customDb || createDatabase();

  if (env.DATABASE_URL) {
    await migratePg(db, { migrationsFolder });
  } else {
    await migratePglite(db, { migrationsFolder });
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
