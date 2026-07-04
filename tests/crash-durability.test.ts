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


