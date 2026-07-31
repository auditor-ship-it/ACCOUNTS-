import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectMongo } from './config/db.js';
import { logger } from './utils/logger.js';

logger.info('[SERVER] Starting Accounts & Collection backend...');

/**
 * Node terminates the whole process on an unhandled promise rejection by
 * default (since Node 15) — one Google Sheets quota error (or any other
 * error) thrown from code that isn't awaited inside a request's try/catch
 * would otherwise take the entire server down for every user until someone
 * manually restarts it. Log and keep serving instead.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('[ERROR] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('[ERROR] Uncaught exception:', err);
});

// Same Mongo database/connection string as the other two apps (shared by
// design — see splendid-rolling-candy.md) — connect before serving, since
// routes call getCollection() synchronously off the shared connection.
await connectMongo();

const app = createApp();

app.listen(env.port, () => {
  logger.info(`[SERVER] Accounts & Collection API running on port ${env.port} (${env.nodeEnv})`);
  // Phase 2 (this pass) is a correctness-neutral lift-and-shift: all reads
  // still go live to Google Sheets, exactly as before the split. Own cron +
  // Sheets<->Mongo sync are deliberately NOT registered yet — that, plus the
  // Mongo-read switch for this domain's list pages and the row-number write
  // rewrites (billing/transport/etc.), is Phase 3, not this pass. See
  // splendid-rolling-candy.md.
  logger.info('[SERVER] Cron + Sheets sync not yet enabled here — Phase 3 (deferred), see splendid-rolling-candy.md.');
});
