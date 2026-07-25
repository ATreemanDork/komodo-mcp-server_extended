/**
 * Application Error Base Class
 *
 * Local copy of mcp-server-framework's errors/core AppError — the class
 * every Komodo-specific error in classes.ts extends. Ported near-verbatim
 * (same fields, same static helpers, same toJSON/toDetailedString
 * behavior); only the imports changed since the framework package itself
 * is no longer a dependency (ErrorCodes/HttpStatus now come from the local
 * ./error-codes.js instead of mcp-server-framework/errors).
 *
 * @module errors/app-error
 */

import { randomUUID } from "node:crypto";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, ErrorCodeToHttpStatus, type ErrorCodeType } from "./error-codes.js";

export interface SerializedError {
  name: string;
  message: string;
  errorId: string;
  code: ErrorCodeType | (string & Record<never, never>);
  statusCode?: number;
  mcpCode?: ErrorCode;
  stack?: string;
  cause?: SerializedError | string;
  context?: Record<string, unknown>;
  timestamp?: string;
  recoveryHint?: string;
}

export interface BaseErrorOptions {
  code?: ErrorCodeType | (string & Record<never, never>);
  statusCode?: number;
  mcpCode?: ErrorCode;
  cause?: Error | undefined;
  context?: Record<string, unknown> | undefined;
  recoveryHint?: string | undefined;
}

export class AppError extends Error {
  readonly errorId: string;
  readonly code: ErrorCodeType | (string & Record<never, never>);
  readonly statusCode: number;
  readonly mcpCode: ErrorCode;
  readonly context?: Record<string, unknown> | undefined;
  readonly cause?: Error | undefined;
  readonly timestamp: Date;
  readonly recoveryHint?: string | undefined;

  constructor(message: string, options: BaseErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.errorId = randomUUID();
    this.code = options.code ?? ErrorCodes.INTERNAL_ERROR;
    this.statusCode = options.statusCode ?? ErrorCodeToHttpStatus[this.code] ?? 500;
    this.mcpCode = options.mcpCode ?? ErrorCode.InternalError;
    this.cause = options.cause;
    this.context = options.context;
    this.timestamp = new Date();
    this.recoveryHint = options.recoveryHint;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): SerializedError {
    const serialized: SerializedError = {
      name: this.name,
      message: this.message,
      errorId: this.errorId,
      code: this.code,
      statusCode: this.statusCode,
      mcpCode: this.mcpCode,
      timestamp: this.timestamp.toISOString(),
    };
    if (process.env["NODE_ENV"] !== "production" && this.stack) {
      serialized.stack = this.stack;
    }
    if (this.cause) {
      serialized.cause = this.cause instanceof AppError ? this.cause.toJSON() : this.cause.message;
    }
    if (process.env["NODE_ENV"] !== "production" && this.context && Object.keys(this.context).length > 0) {
      serialized.context = this.context;
    }
    if (this.recoveryHint) {
      serialized.recoveryHint = this.recoveryHint;
    }
    return serialized;
  }

  toDetailedString(): string {
    let result = `${this.name} [${this.code}] (${this.errorId}): ${this.message}`;
    if (this.recoveryHint) {
      result += ` | Hint: ${this.recoveryHint}`;
    }
    if (this.context && Object.keys(this.context).length > 0) {
      result += ` | Context: ${JSON.stringify(this.context)}`;
    }
    if (this.cause) {
      result +=
        this.cause instanceof AppError
          ? `\n  Caused by: ${this.cause.toDetailedString()}`
          : `\n  Caused by: ${this.cause.message}`;
    }
    return result;
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  static wrap(error: unknown, defaultMessage = "An unexpected error occurred"): AppError {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error) {
      return new AppError(error.message || defaultMessage, {
        cause: error,
        code: ErrorCodes.INTERNAL_ERROR,
      });
    }
    return new AppError(String(error) || defaultMessage, {
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }

  static wrapWithContext(error: unknown, context: Record<string, unknown>): AppError {
    const wrappedError = AppError.wrap(error);
    return new AppError(wrappedError.message, {
      code: wrappedError.code,
      statusCode: wrappedError.statusCode,
      mcpCode: wrappedError.mcpCode,
      cause: wrappedError.cause,
      context: { ...wrappedError.context, ...context },
      recoveryHint: wrappedError.recoveryHint,
    });
  }

  static isCancellation(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return true;
      }
      if (error instanceof AppError && error.code === ErrorCodes.OPERATION_CANCELLED) {
        return true;
      }
    }
    return false;
  }
}
