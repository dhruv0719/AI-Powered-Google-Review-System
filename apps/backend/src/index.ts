import { buildServer } from './server.js';
import { getEnv } from './config/env.js';
import { runMigrations } from './drizzle/migrate.js';
import { getDb } from './db/index.js';
import { startCleanupJob, stopCleanupJob } from './jobs/cleanup.js';

async function main() {
  const env = getEnv();

  // Run DB migrations before starting listener
  await runMigrations();

  // Start background data retention and session cleanup job
  startCleanupJob(getDb());

  const server = buildServer();

  // Handle graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      stopCleanupJob();
      await server.close();
      process.exit(0);
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
