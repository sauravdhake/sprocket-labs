import { Router } from "express";
import type { DB } from "../db.js";
import { withIdempotency } from "../idempotency.js";
import { claimReward } from "../repository.js";
import { claimBodySchema, rewardIdParam, parseOrThrow, requireIdempotencyKey } from "../validation.js";

export function createRewardsRouter(db: DB): Router {
  const router = Router();

  router.post("/rewards/:rewardId/claim", (req, res) => {
    const rewardId = parseOrThrow(rewardIdParam, req.params.rewardId, "rewardId");
    const key = requireIdempotencyKey(req.header("Idempotency-Key"));
    const body = parseOrThrow(claimBodySchema, req.body, "body");

    const result = withIdempotency(
      db,
      { key, method: req.method, path: req.originalUrl, requestBody: { rewardId, ...body } },
      () => {
        const { wallet, alreadyClaimed } = claimReward(db, body.playerId, rewardId);
        return {
          status: 200,
          body: { ...wallet, rewardId, alreadyClaimed },
        };
      },
    );

    res.status(result.status).json(result.body);
  });

  return router;
}
