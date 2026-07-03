import express, { type Request, type Response, type NextFunction } from "express";
import type { DB } from "./db.js";
import { createWalletsRouter } from "./routes/wallets.js";
import { createRewardsRouter } from "./routes/rewards.js";
import { isAppError } from "./errors.js";
import type { CrashHook } from "./repository.js";

export function createApp(db: DB, crashHook?: CrashHook) {
  const app = express();
  app.disable("x-powered-by");

  // 32kb is generous for these payloads (a few short fields) and rejects
  // oversized/garbage bodies before they ever reach our handlers.
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/v1", createWalletsRouter(db, crashHook));
  app.use("/v1", createRewardsRouter(db));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "No such route." });
  });

  // Centralized error handler: converts known AppErrors to their documented
  // status/body, and never leaks internal error details for anything else.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.statusCode).json(err.toBody());
      return;
    }

    // express.json() throws a SyntaxError (with a numeric `.status`/`.statusCode`
    // of 400) for malformed JSON bodies — treat that as a validation error too.
    const maybeStatus = (err as { statusCode?: number; status?: number } | null)?.statusCode
      ?? (err as { statusCode?: number; status?: number } | null)?.status;
    if (typeof maybeStatus === "number" && maybeStatus >= 400 && maybeStatus < 500) {
      res.status(maybeStatus).json({ error: "bad_request", message: "Malformed request." });
      return;
    }

    console.error("Unhandled error:", err);
    res.status(500).json({ error: "internal_error", message: "An unexpected error occurred." });
  });

  return app;
}