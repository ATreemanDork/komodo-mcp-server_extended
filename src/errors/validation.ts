/**
 * Validation Error
 *
 * Ported from `mcp-server-framework`'s `errors/categories/validation.js`
 * (v1.1.2) — the reference repo's own `AppErrorFactory.validation` delegates
 * to this framework class (`FrameworkErrorFactory.validation`), which this
 * project's `errors/factory.ts` originally deferred (deliberately trimmed,
 * see that module's deviation note) until a mechanical
 * port actually needed `validation.fieldRequired`. Only `ValidationError`
 * is ported here — the framework's sibling `ConfigurationError` in the same
 * source file is not currently used by any ported tool and is left for a
 * later fold-in if that changes, rather than ported speculatively.
 *
 * @module errors/validation
 */

import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ZodError } from "zod";
import { AppError, type BaseErrorOptions } from "./app-error.js";
import { ErrorCodes } from "./error-codes.js";
import { isSensitiveKey } from "./sensitive-keys.js";

/** Matches the framework's own redaction limit for displayed values — distinct from this repo's `config/tools.config.ts` `VALIDATION_LIMITS` (a different, tool-input-facing constant). */
const MAX_VALIDATION_VALUE_DISPLAY_LENGTH = 100;
const REDACTED_PLACEHOLDER = "[REDACTED]";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly code?: string | undefined;
}

export interface ValidationErrorOptions extends Omit<BaseErrorOptions, "code"> {
  field?: string | undefined;
  value?: unknown;
  expected?: string | undefined;
  issues?: ValidationIssue[] | undefined;
}

export class ValidationError extends AppError {
  readonly field?: string | undefined;
  readonly value?: unknown;
  readonly issues?: ValidationIssue[] | undefined;

  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
      mcpCode: ErrorCode.InvalidParams,
      cause: options.cause,
      recoveryHint: options.recoveryHint,
      context: {
        ...options.context,
        field: options.field,
        hasValue: options.value !== undefined,
      },
    });
    this.field = options.field;
    this.value = this.sanitizeValue(options.value, options.field);
    this.issues = options.issues;
  }

  private sanitizeValue(value: unknown, fieldName?: string): unknown {
    if (value === undefined || value === null) return value;
    if (fieldName && isSensitiveKey(fieldName)) return REDACTED_PLACEHOLDER;
    if (typeof value === "string") {
      return value.length > MAX_VALIDATION_VALUE_DISPLAY_LENGTH ? `[string:${String(value.length)} chars]` : value;
    }
    if (typeof value === "object") {
      if (Array.isArray(value)) return `[array:${String(value.length)} items]`;
      return `[object:${String(Object.keys(value).length)} keys]`;
    }
    return value;
  }

  static fieldRequired(field: string): ValidationError {
    return new ValidationError(`Field '${field}' is required`, {
      field,
      recoveryHint: `Provide a value for the required field '${field}'.`,
    });
  }

  static fieldInvalid(field: string, value?: unknown): ValidationError {
    return new ValidationError(`Invalid value for field '${field}'`, {
      field,
      value,
      recoveryHint: `Check the value provided for '${field}' and ensure it meets the requirements.`,
    });
  }

  static fieldTypeMismatch(field: string, expectedType: string): ValidationError {
    return new ValidationError(`Field '${field}' must be of type ${expectedType}`, {
      field,
      recoveryHint: `Field '${field}' must be of type '${expectedType}'.`,
    });
  }

  static fieldMin(field: string, min: number): ValidationError {
    return new ValidationError(`Field '${field}' must be at least ${String(min)}`, {
      field,
      recoveryHint: `Provide a value of at least ${String(min)} for '${field}'.`,
    });
  }

  static fieldMax(field: string, max: number): ValidationError {
    return new ValidationError(`Field '${field}' must be at most ${String(max)}`, {
      field,
      recoveryHint: `Provide a value of at most ${String(max)} for '${field}'.`,
    });
  }

  static fieldPattern(field: string): ValidationError {
    return new ValidationError(`Field '${field}' does not match the required pattern`, {
      field,
      recoveryHint: `Ensure '${field}' matches the expected format.`,
    });
  }

  static fromZodError(zodError: ZodError, message?: string): ValidationError {
    const issues: ValidationIssue[] = zodError.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    const primaryIssue = issues[0];
    const errorMessage = message ?? primaryIssue?.message ?? "Validation failed";
    return new ValidationError(errorMessage, {
      field: primaryIssue?.path,
      issues,
      cause: zodError,
      recoveryHint: "Check the input parameters against the expected schema.",
    });
  }

  formatIssues(): string {
    if (!this.issues || this.issues.length === 0) return this.message;
    return this.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
  }
}
