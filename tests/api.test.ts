import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { startTestServer, post, get, type TestServer } from "./helpers.js";

describe("wallet API", () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  
  test("GET on unknown player returns zeroed implicit wallet", async () => {
    const res = await get(server.baseUrl, "/v1/wallets/nobody");
    assert.equal(res.status, 200);
    
    assert.deepEqual(res.json, { playerId: "nobody", balance: 0, inventory: [], claimedRewards: [] });
  });

  test("credit requires Idempotency-Key header", async () => {
    const res = await post(server.baseUrl, "/v1/wallets/p1/credit", { amount: 10, reason: "x" });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error: string }).error, "idempotency_key_required");
  });

  test("credit increases balance", async () => {
    const key = randomUUID();
    const res = await post(server.baseUrl, "/v1/wallets/p2/credit", { amount: 100, reason: "bonus" }, key);
    assert.equal(res.status, 200);
    assert.equal((res.json as { balance: number }).balance, 100);

    const get1 = await get(server.baseUrl, "/v1/wallets/p2");
    assert.equal((get1.json as { balance: number }).balance, 100);
  });

  test("credit validation rejects non-positive / non-integer amounts", async () => {
    const bad = [{ amount: 0, reason: "x" }, { amount: -5, reason: "x" }, { amount: 1.5, reason: "x" }, { reason: "x" }];
    for (const body of bad) {
      const res = await post(server.baseUrl, "/v1/wallets/p3/credit", body, randomUUID());
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test("purchase debits balance and grants item", async () => {
    await post(server.baseUrl, "/v1/wallets/p4/credit", { amount: 100, reason: "seed" }, randomUUID());
    const res = await post(server.baseUrl, "/v1/wallets/p4/purchase", { itemId: "sword", price: 40 }, randomUUID());
    assert.equal(res.status, 200);
    const body = res.json as { balance: number; inventory: string[] };
    assert.equal(body.balance, 60);
    assert.deepEqual(body.inventory, ["sword"]);
  });

  test("purchase fails with 409 insufficient_funds and makes no changes", async () => {
    await post(server.baseUrl, "/v1/wallets/p5/credit", { amount: 10, reason: "seed" }, randomUUID());
    const res = await post(server.baseUrl, "/v1/wallets/p5/purchase", { itemId: "sword", price: 999 }, randomUUID());
    assert.equal(res.status, 409);
    assert.equal((res.json as { error: string }).error, "insufficient_funds");

    const wallet = await get(server.baseUrl, "/v1/wallets/p5");
    const body = wallet.json as { balance: number; inventory: string[] };
    assert.equal(body.balance, 10);
    assert.deepEqual(body.inventory, []);
  });

  test("retrying credit with the same Idempotency-Key applies it exactly once", async () => {
    const key = randomUUID();
    const body = { amount: 50, reason: "double-submit test" };
    const first = await post(server.baseUrl, "/v1/wallets/p6/credit", body, key);
    const second = await post(server.baseUrl, "/v1/wallets/p6/credit", body, key);
    const third = await post(server.baseUrl, "/v1/wallets/p6/credit", body, key);

    assert.deepEqual(first.json, second.json);
    assert.deepEqual(second.json, third.json);

    const wallet = await get(server.baseUrl, "/v1/wallets/p6");
    assert.equal((wallet.json as { balance: number }).balance, 50);
  });

  test("reusing an Idempotency-Key with a different body is rejected", async () => {
    const key = randomUUID();
    const first = await post(server.baseUrl, "/v1/wallets/p7/credit", { amount: 10, reason: "a" }, key);
    assert.equal(first.status, 200);

    const second = await post(server.baseUrl, "/v1/wallets/p7/credit", { amount: 20, reason: "b" }, key);
    assert.equal(second.status, 409);
    assert.equal((second.json as { error: string }).error, "idempotency_key_reused");
  });

  test("retrying a failed (insufficient_funds) purchase with the same key replays the same rejection", async () => {
    await post(server.baseUrl, "/v1/wallets/p8/credit", { amount: 5, reason: "seed" }, randomUUID());
    const key = randomUUID();
    const body = { itemId: "castle", price: 1000 };
    const first = await post(server.baseUrl, "/v1/wallets/p8/purchase", body, key);
    const second = await post(server.baseUrl, "/v1/wallets/p8/purchase", body, key);
    assert.equal(first.status, 409);
    assert.deepEqual(first.json, second.json);
  });

  test("reward claim grants once; repeated claims report alreadyClaimed without re-granting", async () => {
    const first = await post(server.baseUrl, "/v1/rewards/daily/claim", { playerId: "p9" }, randomUUID());
    assert.equal(first.status, 200);
    assert.equal((first.json as { alreadyClaimed: boolean }).alreadyClaimed, false);

    const second = await post(server.baseUrl, "/v1/rewards/daily/claim", { playerId: "p9" }, randomUUID());
    assert.equal(second.status, 200);
    assert.equal((second.json as { alreadyClaimed: boolean }).alreadyClaimed, true);

    const wallet = await get(server.baseUrl, "/v1/wallets/p9");
    assert.deepEqual((wallet.json as { claimedRewards: string[] }).claimedRewards, ["daily"]);
  });

  test("playerId / rewardId / itemId reject unsafe characters", async () => {
    const res = await get(server.baseUrl, "/v1/wallets/" + encodeURIComponent("../etc/passwd"));
    assert.equal(res.status, 400);

    const res2 = await post(server.baseUrl, "/v1/wallets/p10/purchase", { itemId: "bad id!", price: 1 }, randomUUID());
    assert.equal(res2.status, 400);
  });

  test("amount above MAX_AMOUNT is rejected", async () => {
    const res = await post(server.baseUrl, "/v1/wallets/p11/credit", { amount: 2_000_000_000, reason: "x" }, randomUUID());
    assert.equal(res.status, 400);
  });

  test("unknown route returns 404", async () => {
    const res = await get(server.baseUrl, "/v1/nonexistent");
    assert.equal(res.status, 404);
  });

});
