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

});
