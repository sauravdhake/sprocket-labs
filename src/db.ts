import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  player_id TEXT PRIMARY KEY,
  balance   INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_player ON inventory_items(player_id);

CREATE TABLE IF NOT EXISTS claimed_rewards (
  player_id  TEXT NOT NULL,
  reward_id  TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (player_id, reward_id)
);

-- Idempotency ledger: one row per client-supplied Idempotency-Key.
-- The mutation this key protects and this row are written in the SAME
-- SQLite transaction, so either both are durable after commit or neither is.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);
`;

export interface OpenDbOptions {
  /** Path to the SQLite file. Use ":memory:" only for throwaway tests. */
  dbPath: string;
}

export function openDb({ dbPath }: OpenDbOptions): DB {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // WAL mode: writers don't block readers, and committed transactions are
  // durably recorded in the write-ahead log before being checkpointed into
  // the main file — this is what lets a killed-and-restarted process see
  // every committed write and nothing else.
  db.exec("PRAGMA journal_mode = WAL");

  // synchronous=FULL forces an fsync on every transaction commit. This is
  // slower than NORMAL, but NORMAL only guarantees consistency across an
  // application crash (kill -9) and can still lose the most recent commits
  // on an OS crash/power loss. Since durability is the top-priority
  // requirement here, we pay the fsync cost for the stronger guarantee.
  db.exec("PRAGMA synchronous = FULL");

  db.exec("PRAGMA foreign_keys = ON");

  db.exec(SCHEMA);

  return db;
}

/**
 * Runs `fn` inside a SQLite IMMEDIATE transaction. IMMEDIATE acquires the
 * write lock at the start of the transaction rather than lazily on the
 * first write, closing the read-then-upgrade race that a DEFERRED
 * transaction would allow between two concurrent requests that both read
 * the same wallet balance before either has written. Combined with
 * node:sqlite's synchronous, single-connection API and Node's single
 * JS thread, this fully serializes conflicting requests.
 *
 * On any thrown error the transaction is rolled back and the error
 * re-thrown; on success it is committed before returning.
 */
export function runInTransaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // If the connection is already gone (e.g. mid-crash-test), there's
      // nothing left to roll back — ignore.
    }
    throw err;
  }
}

/**
 * Idempotency keys don't need to live forever — a client only ever retries
 * within a bounded window after a request (network blip, client restart,
 * etc). We retain keys for RETENTION_MS and opportunistically prune older
 * ones on startup, so the table doesn't grow unbounded in a long-running
 * deployment without needing a separate scheduler/cron dependency.
 */
export const IDEMPOTENCY_KEY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function pruneExpiredIdempotencyKeys(db: DB, retentionMs = IDEMPOTENCY_KEY_RETENTION_MS): number {
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const stmt = db.prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`);
  const result = stmt.run(cutoff);
  return Number(result.changes);
}
