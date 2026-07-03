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