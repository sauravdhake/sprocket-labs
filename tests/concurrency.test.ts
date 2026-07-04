import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, post, get, type TestServer } from "./helpers.js";

describe("concurrency correctness", () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  test("N concurrent purchases that can only be afforded once never double-spend", async () => {
    const playerId = "racer1";
    await post(server.baseUrl, `/v1/wallets/${playerId}/credit`, { amount: 100, reason: "seed" }, randomUUID());

    // 20 concurrent purchase attempts, each costing 100 — the wallet can
    // afford exactly ONE of them. If the server had a read-then-write race
    // (e.g. read balance, then separately write new balance) more than one
    // of these could succeed. With IMMEDIATE transactions they must be fully
    // serialized: exactly one 200, the rest 409 insufficient_funds.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      post(server.baseUrl, `/v1/wallets/${playerId}/purchase`, { itemId: `item-${i}`, price: 100 }, randomUUID()),
    );
    const results = await Promise.all(attempts);

    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status === 409);

    assert.equal(successes.length, 1, `expected exactly 1 success, got ${successes.length}`);
    assert.equal(failures.length, 19);

    const wallet = await get(server.baseUrl, `/v1/wallets/${playerId}`);
    const body = wallet.json as { balance: number; inventory: string[] };
    assert.equal(body.balance, 0);
    assert.equal(body.inventory.length, 1);
  });

  test("N concurrent requests with the SAME Idempotency-Key apply the effect exactly once", async () => {
    const playerId = "racer2";
    await post(server.baseUrl, `/v1/wallets/${playerId}/credit`, { amount: 500, reason: "seed" }, randomUUID());

    const key = randomUUID();
    const body = { itemId: "unique-item", price: 30 };
    const attempts = Array.from({ length: 15 }, () => post(server.baseUrl, `/v1/wallets/${playerId}/purchase`, body, key));
    const results = await Promise.all(attempts);

    for (const r of results) {
      assert.equal(r.status, 200);
    }
    const firstBody = JSON.stringify(results[0]?.json);
    for (const r of results) {
      assert.equal(JSON.stringify(r.json), firstBody);
    }

    const wallet = await get(server.baseUrl, `/v1/wallets/${playerId}`);
    const body2 = wallet.json as { balance: number; inventory: string[] };
    assert.equal(body2.balance, 470);
    assert.equal(body2.inventory.length, 1);
  });

});
