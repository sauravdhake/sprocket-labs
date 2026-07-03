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

