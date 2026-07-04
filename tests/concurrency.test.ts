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

});
