export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toBody(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "validation_error", message, details);
    this.name = "ValidationError";
  }
}

export class IdempotencyKeyMissingError extends AppError {
  constructor() {
    super(400, "idempotency_key_required", "The 'Idempotency-Key' header is required for this request.");
    this.name = "IdempotencyKeyMissingError";
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      409,
      "idempotency_key_reused",
      "This Idempotency-Key was already used with a different request body. Use a new key for a new request.",
    );
    this.name = "IdempotencyConflictError";
  }
}

export class InsufficientFundsError extends AppError {
  constructor(balance: number, price: number) {
    super(409, "insufficient_funds", "Wallet balance is insufficient for this purchase.", { balance, price });
    this.name = "InsufficientFundsError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
