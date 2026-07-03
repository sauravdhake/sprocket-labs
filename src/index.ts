import { openDb, pruneExpiredIdempotencyKeys } from "./db.js";
import { createApp } from "./app.js";
import type { CrashHook } from "./repository.js";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "./data/economy.db";

/**
 * Test-only fault injection: when TEST_CRASH_POINT="after-debit-before-grant"
 * is set, the server kills its own process the instant a purchase has debited
 * the balance but before it has granted the item — landing kill -9 exactly
 * "in the middle of a purchase" as the assessment requires, deterministically
 * instead of relying on timing luck. This code path is inert unless that
 * env var is explicitly set, so it has zero effect in normal operation.
 */
const crashHook: CrashHook | undefined =
  process.env.TEST_CRASH_POINT === "after-debit-before-grant"
    ? (point) => {
        if (point === "after-debit-before-grant") {
          process.kill(process.pid, "SIGKILL");
        }
      }
    : undefined;

const db = openDb({ dbPath: DB_PATH });
pruneExpiredIdempotencyKeys(db);

const app = createApp(db, crashHook);

const server = app.listen(PORT, () => {
  console.log(`economy-service listening on port ${PORT} (db: ${DB_PATH})`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));