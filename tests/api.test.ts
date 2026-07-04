import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

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

});
