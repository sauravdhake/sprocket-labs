/**
 * Hand-written OpenAPI spec for the four real endpoints this service
 * exposes. Written by hand (not generated) so it exactly mirrors the real
 * Zod schemas in `validation.ts` — a hand-written spec that matches the
 * real implementation is more trustworthy than a generated best-guess that
 * could silently drift from it.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Economy Service",
    version: "1.0.0",
    description:
      "Durable wallet/economy backend: credit, purchase, and one-time reward claim, with exactly-once and crash-safe guarantees.",
  },
  servers: [{ url: "/v1" }],
  components: {
    schemas: {
      Wallet: {
        type: "object",
        properties: {
          playerId: { type: "string" },
          balance: { type: "integer" },
          inventory: { type: "array", items: { type: "string" } },
          claimedRewards: { type: "array", items: { type: "string" } },
        },
        required: ["playerId", "balance", "inventory", "claimedRewards"],
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        required: ["error", "message"],
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", maxLength: 200 },
        description:
          "Client-generated key (e.g. a UUID). Retrying the same request with the same key returns the same result exactly once.",
      },
    },
  },
  paths: {
    "/wallets/{playerId}": {
      get: {
        summary: "Read a wallet",
        parameters: [{ name: "playerId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Current wallet state",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } },
          },
        },
      },
    },
    "/wallets/{playerId}/credit": {
      post: {
        summary: "Credit currency to a wallet",
        parameters: [
          { name: "playerId", in: "path", required: true, schema: { type: "string" } },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  amount: { type: "integer", minimum: 1, maximum: 1000000000 },
                  reason: { type: "string", maxLength: 200 },
                },
                required: ["amount", "reason"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated wallet state",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } },
          },
          "400": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "409": {
            description: "Idempotency key reused with a different body",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/wallets/{playerId}/purchase": {
      post: {
        summary: "Atomically debit currency and grant an item",
        parameters: [
          { name: "playerId", in: "path", required: true, schema: { type: "string" } },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  itemId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" },
                  price: { type: "integer", minimum: 1, maximum: 1000000000 },
                },
                required: ["itemId", "price"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated wallet state",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } },
          },
          "409": {
            description: "Insufficient funds, or idempotency key reused",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/rewards/{rewardId}/claim": {
      post: {
        summary: "Claim a one-time reward for a player",
        parameters: [
          { name: "rewardId", in: "path", required: true, schema: { type: "string" } },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { playerId: { type: "string" } },
                required: ["playerId"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Reward state (idempotent — repeat claims return alreadyClaimed: true)",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Wallet" },
                    {
                      type: "object",
                      properties: {
                        rewardId: { type: "string" },
                        alreadyClaimed: { type: "boolean" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
