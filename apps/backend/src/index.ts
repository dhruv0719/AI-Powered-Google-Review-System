import { buildServer } from './server.js';
import { getEnv } from './config/env.js';
import { runMigrations } from './drizzle/migrate.js';
import { getDb, closeDatabase } from './db/index.js';
import { startCleanupJob, stopCleanupJob } from './jobs/cleanup.js';

let isShuttingDown = false;

async function handleShutdown(server: ReturnType<typeof buildServer>, signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Initiating graceful shutdown...`);

  try {
    // 1. Stop background periodic tasks first
    stopCleanupJob();

    // 2. Close HTTP server so no new incoming requests are accepted
    // and wait for active inflight requests to complete
    await server.close();
    console.log('HTTP server closed.');

    // 3. Gracefully terminate database connection pool after HTTP requests finish
    await closeDatabase();
    console.log('Database connections closed cleanly.');

    process.exit(0);
  } catch (err) {
    console.error('Error occurred during graceful shutdown:', err);
    process.exit(1);
  }
}

async function main() {
  const env = getEnv();

  // Run DB migrations before starting listener
  await runMigrations();

  // Start background data retention and session cleanup job
  startCleanupJob(getDb());

  const server = buildServer();

  // Handle graceful shutdown without duplicate registration
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      void handleShutdown(server, signal);
    });
  }

  try {
    const address = await server.listen({ port: env.PORT, host: env.HOST });
    console.log(`Review SaaS Backend listening at ${address}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('index')) {
  main();
}
