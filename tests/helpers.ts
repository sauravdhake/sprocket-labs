import { openDb, pruneExpiredIdempotencyKeys, type DB } from "../src/db.js";
import { createApp } from "../src/app.js";
import http from "node:http";

export function makeTestDb(): DB {
  const db = openDb({ dbPath: ":memory:" });
  pruneExpiredIdempotencyKeys(db);
  return db;
}

export interface TestServer {
  baseUrl: string;
  db: DB;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const db = makeTestDb();
  const app = createApp(db);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to bind test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    db,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export async function post(baseUrl: string, path: string, body: unknown, idempotencyKey?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey !== undefined ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, json };
}

export async function get(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json().catch(() => undefined);
  return { status: res.status, json };
}