import { buildServer } from './server.js';
import { getEnv } from './config/env.js';
import { runMigrations } from './drizzle/migrate.js';

async function main() {
  const env = getEnv();

  // Run DB migrations before starting listener
  await runMigrations();

  const server = buildServer();

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
