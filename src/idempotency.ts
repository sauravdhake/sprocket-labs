import crypto from "node:crypto";
import type { DB } from "./db.js";
import { runInTransaction } from "./db.js";
import { isAppError, AppError, IdempotencyConflictError } from "./errors.js";

export interface HandlerResult {
  status: number;
  body: unknown;
}

interface IdempotentRequestContext {
  key: string;
  method: string;
  path: string;
  requestBody: unknown;
}

function fingerprint(method: string, path: string, requestBody: unknown): string {
  const canonical = JSON.stringify({ method, path, requestBody });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Runs `effect` exactly once per Idempotency-Key.
 *
 * The idempotency-key lookup/insert and the business effect execute inside a
 * single IMMEDIATE SQLite transaction, so:
 *   - If the process is killed at any point before COMMIT, SQLite's
 *     write-ahead log never records the transaction and, on restart, it is
 *     as if the request never happened — a retry with the same key will
 *     execute `effect` fresh and produce a real result.
 *   - If the process is killed after COMMIT, the effect AND the cached
 *     response are both durably recorded together — a retry with the same
 *     key will find the cached response and replay it without re-running
 *     `effect`.
 * There is no window where the effect is committed but the idempotency
 * record is not (or vice versa), because they are the same transaction.
 *
 * `effect` may throw an AppError to signal a well-defined, deterministic
 * business rejection (e.g. insufficient funds). That rejection is cached
 * exactly like a success, so retries always see the same outcome regardless
 * of how the world (e.g. the wallet balance) has changed since. Any other
 * (unexpected) error propagates and rolls back the whole transaction,
 * including the idempotency row — so a transient/unknown failure never
 * "poisons" a key with a permanent 500 that could never be retried past.
 */
export function withIdempotency(
  db: DB,
  ctx: IdempotentRequestContext,
  effect: () => HandlerResult,
): HandlerResult {
  return runInTransaction(db, () => {
    const existing = db
      .prepare(
        `SELECT request_fingerprint, status_code, response_body FROM idempotency_keys WHERE idempotency_key = ?`,
      )
      .get(ctx.key) as { request_fingerprint: string; status_code: number; response_body: string } | undefined;

    const thisFingerprint = fingerprint(ctx.method, ctx.path, ctx.requestBody);

    if (existing) {
      if (existing.request_fingerprint !== thisFingerprint) {
        throw new IdempotencyConflictError();
      }
      return { status: existing.status_code, body: JSON.parse(existing.response_body) };
    }

    let result: HandlerResult;
    try {
      result = effect();
    } catch (err) {
      if (isAppError(err)) {
        result = { status: err.statusCode, body: err.toBody() };
      } else {
        // Unknown/unexpected error: abort the whole transaction (including
        // the idempotency-key lookup) so nothing is cached and the key
        // remains retryable once the underlying bug/condition is fixed.
        throw err;
      }
    }

    db.prepare(
      `INSERT INTO idempotency_keys (idempotency_key, method, path, request_fingerprint, status_code, response_body)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(ctx.key, ctx.method, ctx.path, thisFingerprint, result.status, JSON.stringify(result.body));

    return result;
  });
}

export { AppError };
