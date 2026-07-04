import { Router } from "express";
import type { DB } from "../db.js";
import { withIdempotency } from "../idempotency.js";
import { creditWallet, purchase, readWalletState, type CrashHook } from "../repository.js";
import { creditBodySchema, purchaseBodySchema, playerIdParam, parseOrThrow, requireIdempotencyKey } from "../validation.js";

export function createWalletsRouter(db: DB, crashHook?: CrashHook): Router {
  const router = Router();

  router.get("/wallets/:playerId", (req, res) => {
    const playerId = parseOrThrow(playerIdParam, req.params.playerId, "playerId");
    const wallet = readWalletState(db, playerId);
    res.status(200).json(wallet);
  });

  router.post("/wallets/:playerId/credit", (req, res) => {
    const playerId = parseOrThrow(playerIdParam, req.params.playerId, "playerId");
    const key = requireIdempotencyKey(req.header("Idempotency-Key"));
    const body = parseOrThrow(creditBodySchema, req.body, "body");

    //Credit increases the balance with idempotency
    const result = withIdempotency(
      db,
      { key, method: req.method, path: req.originalUrl, requestBody: { playerId, ...body } },
      () => {
        const wallet = creditWallet(db, playerId, body.amount);
        return { status: 200, body: wallet };
      },
    );

    res.status(result.status).json(result.body);
  });

  router.post("/wallets/:playerId/purchase", (req, res) => {
    const playerId = parseOrThrow(playerIdParam, req.params.playerId, "playerId");
    const key = requireIdempotencyKey(req.header("Idempotency-Key"));
    const body = parseOrThrow(purchaseBodySchema, req.body, "body");

    const result = withIdempotency(
      db,
      { key, method: req.method, path: req.originalUrl, requestBody: { playerId, ...body } },
      () => {
        const wallet = purchase(db, playerId, body.itemId, body.price, crashHook);
        return { status: 200, body: wallet };
      },
    );

    res.status(result.status).json(result.body);
  });

  return router;
}
