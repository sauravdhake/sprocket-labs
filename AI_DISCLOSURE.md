# AI_DISCLOSURE.md

## Tools used

AI-assisted: Replit Agent, used in two distinct and separate ways described below.

## Where and how much

| Area | AI involvement | Notes |
|---|---|---|
| API design (routes, status codes, error shape) | Self-authored | Decided independently; no AI input on the contract itself. |
| Idempotency / transaction strategy (`idempotency.ts`, `db.ts`) | Self-authored, AI used only for syntax lookup | The design (single-transaction idempotency record + effect, `BEGIN IMMEDIATE` for write-lock ordering, WAL + `synchronous=FULL`) is my own reasoning. I used AI to confirm exact TypeScript/`node:sqlite` API syntax (e.g. `DatabaseSync` method signatures, prepared-statement calls) while implementing it. |
| Business logic (`repository.ts`) | Self-authored, AI used only for syntax lookup | Same as above — logic and invariants are mine; AI used for language/API syntax only. |
| Validation (`validation.ts`) | Self-authored, AI used only for syntax lookup | Zod schema logic and limits are mine; AI used to confirm Zod v3 API syntax. |
| Tests (`tests/*.test.ts`, incl. concurrency and crash-durability tests) | Self-authored, AI used only for syntax lookup | Test scenarios (20 concurrent purchases, duplicate-key replay, real `kill -9` mid-purchase) and assertions are mine; AI used for `node:test`/`node:child_process` syntax details. |
| `DESIGN.md` / `RESILIENCE.md` / `README.md` diagrams | AI-drafted from my working code, reviewed and corrected by me | After the implementation was done, I used Replit Agent to read the actual source and generate the architecture diagrams, ER diagram, and sequence diagrams, and to draft the written explanations. I reviewed these against my own code and corrected anything that didn't match actual behavior. |
| Docker/build setup | AI-assisted | Dockerfile and docker-compose.yml were drafted with AI help and reviewed/tested by me. |

## What I wrote myself, unassisted

The core design decisions and their implementation: choosing SQLite/`node:sqlite` and justifying it, the idempotency-key mechanism, the single-transaction atomicity approach, `BEGIN IMMEDIATE` for concurrency correctness, the claim-once primary-key invariant, input validation rules and limits, and all test scenarios and their assertions. AI was consulted only for TypeScript and `node:sqlite`/Zod syntax while writing this code — not for the correctness strategy itself.

## What I verified rather than trusted

I ran the concurrency and crash-durability tests myself against the real service (including the actual `kill -9` mid-purchase test) to confirm the durability and exactly-once claims before writing them into `DESIGN.md`, rather than taking a generated explanation at face value.

## Honesty check

Every claim in `DESIGN.md`/`RESILIENCE.md` was checked against the actual code and test behavior before being written down. I can walk through and explain any line in `idempotency.ts`, `db.ts`, or `repository.ts` — the reasoning behind them is mine.
