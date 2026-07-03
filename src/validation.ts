import { z } from "zod";
import { ValidationError, IdempotencyKeyMissingError } from "./errors.js";

export const MAX_AMOUNT = 1_000_000_000; // 1 billion minor units — comfortably below Number.MAX_SAFE_INTEGER
export const MAX_ID_LENGTH = 128;
export const MAX_REASON_LENGTH = 200;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

export const playerIdParam = z
  .string()
  .min(1, "playerId must not be empty")
  .max(MAX_ID_LENGTH, `playerId must be at most ${MAX_ID_LENGTH} characters`)
  .regex(idPattern, "playerId may only contain letters, numbers, '-' and '_'");

export const rewardIdParam = z
  .string()
  .min(1, "rewardId must not be empty")
  .max(MAX_ID_LENGTH, `rewardId must be at most ${MAX_ID_LENGTH} characters`)
  .regex(idPattern, "rewardId may only contain letters, numbers, '-' and '_'");

const positiveIntAmount = z
  .number({ invalid_type_error: "must be a number" })
  .int("must be an integer")
  .positive("must be greater than 0")
  .max(MAX_AMOUNT, `must be at most ${MAX_AMOUNT}`);

export const creditBodySchema = z.object({
  amount: positiveIntAmount,
  reason: z.string().min(1, "reason must not be empty").max(MAX_REASON_LENGTH),
});

export const purchaseBodySchema = z.object({
  itemId: z
    .string()
    .min(1, "itemId must not be empty")
    .max(MAX_ID_LENGTH, `itemId must be at most ${MAX_ID_LENGTH} characters`)
    .regex(idPattern, "itemId may only contain letters, numbers, '-' and '_'"),
  price: positiveIntAmount,
});

export const claimBodySchema = z.object({
  playerId: playerIdParam,
});

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue ? `${label}: ${firstIssue.path.join(".") || label} ${firstIssue.message}` : `${label} is invalid`;
    throw new ValidationError(message, result.error.issues);
  }
  return result.data;
}

export function requireIdempotencyKey(rawKey: unknown): string {
  if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
    throw new IdempotencyKeyMissingError();
  }
  if (rawKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationError(`Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  return rawKey;
}