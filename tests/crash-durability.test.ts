import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * This test proves crash durability end-to-end against the REAL compiled
 * server process (not an in-process mock): it starts the actual server as a
 * child process, sends a purchase request whose handler is instrumented
 * (via TEST_CRASH_POINT) to SIGKILL the process partway through the purchase
 * transaction — after the debit, before the item is granted — then restarts
 * the exact same server against the exact same database file and asserts
 * the wallet shows NEITHER the debit NOR the item: the whole transaction
 * was rolled back by SQLite's crash recovery, exactly as if the request had
 * never been received.
 */

const projectRoot = path.resolve(import.meta.dirname, "..");

interface Proc {
  port: number;
  wait: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: () => void;
}

function startServer(dbPath: string, port: number, crashPoint?: string): Proc {
  const child = spawn(process.execPath, ["--experimental-sqlite", "--import", "tsx", "src/index.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      ...(crashPoint ? { TEST_CRASH_POINT: crashPoint } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  return { port, wait, kill: () => child.kill("SIGKILL") };
}

async function waitForReady(port: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server on port ${port} did not become ready in time`);
}

describe("crash durability (real process, kill -9 mid-purchase)", () => {
  test("a purchase killed between debit and grant leaves NO partial effect after restart", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "economy-crash-test-"));
    const dbPath = path.join(tmpDir, "economy.db");
    const port = 4100 + Math.floor(Math.random() * 500);

    // 1. Start the server normally and seed a wallet.
    const server1 = startServer(dbPath, port);
    await waitForReady(port);
    const seedRes = await fetch(`http://127.0.0.1:${port}/v1/wallets/crashvictim/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ amount: 100, reason: "seed" }),
    });
    assert.equal(seedRes.status, 200);
    server1.kill();
    await server1.wait;

    // 2. Restart the SAME db with the crash hook armed, and fire a purchase
    //    that the server will SIGKILL itself in the middle of.
    const server2 = startServer(dbPath, port, "after-debit-before-grant");
    await waitForReady(port);

    const purchaseKey = randomUUID();
    const purchasePromise = fetch(`http://127.0.0.1:${port}/v1/wallets/crashvictim/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": purchaseKey },
      body: JSON.stringify({ itemId: "sword", price: 40 }),
    }).catch(() => undefined); // the connection will be reset by the kill — that's expected

    const exit = await server2.wait;
    await purchasePromise;

    // The process must actually have been killed (proves the fault injection fired).
    // On POSIX, Node reports this as signal "SIGKILL". On Windows, `child_process`
    // never reports a signal name (it's always null, even for a real forceful
    // kill) — Windows has no POSIX signal concept, so Node can only report that
    // the process died with a non-zero/unknown exit code, not which signal.
    if (process.platform === "win32") {
      assert.notEqual(exit.code, 0, "server must not have exited cleanly (code 0) after the crash hook fired");
    } else {
      assert.equal(exit.signal, "SIGKILL");
    }

    // 3. Restart the server fresh against the same database file.
    const port3 = port + 1;
    const server3 = startServer(dbPath, port3);
    try {
      await waitForReady(port3);

      const wallet = await fetch(`http://127.0.0.1:${port3}/v1/wallets/crashvictim`).then((r) => r.json());
      // The purchase transaction must be entirely absent: full balance intact,
      // no item granted. Not "balance debited but item missing" (partial
      // effect) — genuinely as if the request never happened.
      assert.equal((wallet as { balance: number }).balance, 100, "balance must be fully intact after crash");
      assert.deepEqual((wallet as { inventory: string[] }).inventory, [], "no item may be granted after crash");

      // 4. Retrying the SAME purchase with the SAME idempotency key against
      //    the recovered server must now succeed normally exactly once,
      //    proving the key was not "poisoned" by the crash.
      const retry = await fetch(`http://127.0.0.1:${port3}/v1/wallets/crashvictim/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": purchaseKey },
        body: JSON.stringify({ itemId: "sword", price: 40 }),
      });
      assert.equal(retry.status, 200);
      const retryBody = (await retry.json()) as { balance: number; inventory: string[] };
      assert.equal(retryBody.balance, 60);
      assert.deepEqual(retryBody.inventory, ["sword"]);
    } finally {
      server3.kill();
      await server3.wait;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
