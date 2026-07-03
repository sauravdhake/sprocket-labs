import type { DB } from "./db.js";
import { InsufficientFundsError } from "./errors.js";

export interface WalletState {
  playerId: string;
  balance: number;
  inventory: string[];
  claimedRewards: string[];
}

function getOrCreateWallet(db: DB, playerId: string): { balance: number } {
  db.prepare(`INSERT OR IGNORE INTO wallets (player_id, balance) VALUES (?, 0)`).run(playerId);
  const row = db.prepare(`SELECT balance FROM wallets WHERE player_id = ?`).get(playerId) as { balance: number };
  return row;
}

export function readWalletState(db: DB, playerId: string): WalletState {
  const wallet = db.prepare(`SELECT balance FROM wallets WHERE player_id = ?`).get(playerId) as
    | { balance: number }
    | undefined;

  const inventoryRows = db
    .prepare(`SELECT item_id FROM inventory_items WHERE player_id = ? ORDER BY id ASC`)
    .all(playerId) as { item_id: string }[];

  const rewardRows = db
    .prepare(`SELECT reward_id FROM claimed_rewards WHERE player_id = ? ORDER BY claimed_at ASC`)
    .all(playerId) as { reward_id: string }[];

  return {
    playerId,
    balance: wallet?.balance ?? 0,
    inventory: inventoryRows.map((r) => r.item_id),
    claimedRewards: rewardRows.map((r) => r.reward_id),
  };
}

/**
 * Credits a player's wallet. Called from within the idempotency-wrapped
 * transaction, so this is already atomic and durable with the caller.
 */
export function creditWallet(db: DB, playerId: string, amount: number): WalletState {
  getOrCreateWallet(db, playerId);
  db.prepare(`UPDATE wallets SET balance = balance + ? WHERE player_id = ?`).run(amount, playerId);
  return readWalletState(db, playerId);
}

export interface CrashHook {
  /** Test-only hook invoked at a named point inside the purchase transaction. */
  (point: "after-debit-before-grant"): void;
}

/**
 * Atomically debits `price` and grants `itemId`. Throws InsufficientFundsError
 * (no writes performed) if the balance can't cover the price.
 *
 * `onPoint` is an optional test-only fault-injection hook (see tests/) used to
 * simulate `kill -9` landing exactly between the debit and the grant, to prove
 * the transaction is genuinely all-or-nothing rather than just "probably fine".
 */
export function purchase(
  db: DB,
  playerId: string,
  itemId: string,
  price: number,
  onPoint?: CrashHook,
): WalletState {
  const wallet = getOrCreateWallet(db, playerId);
  if (wallet.balance < price) {
    throw new InsufficientFundsError(wallet.balance, price);
  }

  db.prepare(`UPDATE wallets SET balance = balance - ? WHERE player_id = ?`).run(price, playerId);

  onPoint?.("after-debit-before-grant");

  db.prepare(`INSERT INTO inventory_items (player_id, item_id) VALUES (?, ?)`).run(playerId, itemId);

  return readWalletState(db, playerId);
}

export interface ClaimResult {
  wallet: WalletState;
  alreadyClaimed: boolean;
}

/**
 * Grants a reward once per player. If the reward was already claimed by this
 * player (via any prior request, any idempotency key), this is a no-op that
 * reports `alreadyClaimed: true` instead of granting it again — claim-once is
 * a business-level invariant enforced by the (player_id, reward_id) primary
 * key, independent of and in addition to the request-level idempotency key.
 */
export function claimReward(db: DB, playerId: string, rewardId: string): ClaimResult {
  getOrCreateWallet(db, playerId);
  const already = db
    .prepare(`SELECT 1 FROM claimed_rewards WHERE player_id = ? AND reward_id = ?`)
    .get(playerId, rewardId);

  if (already) {
    return { wallet: readWalletState(db, playerId), alreadyClaimed: true };
  }

  db.prepare(`INSERT INTO claimed_rewards (player_id, reward_id) VALUES (?, ?)`).run(playerId, rewardId);
  return { wallet: readWalletState(db, playerId), alreadyClaimed: false };
}