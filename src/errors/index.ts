/**
 * Application Errors Module
 *
 * Ported from the reference repo's errors/index.ts. The final re-export
 * block (`AppError`, `FrameworkErrorFactory`, `ErrorCodeType`,
 * `BaseErrorOptions`, `ErrorCodes`, `HttpStatus` from mcp-server-framework)
 * now points at the local ./app-error.js and ./error-codes.js ports
 * instead; `FrameworkErrorFactory` itself has no local equivalent (see the
 * deviation note in ./factory.ts) and is intentionally not re-exported.
 *
 * @module errors
 */

// Messages
export { AppMessages, getAppMessage, type AppMessageKey, type MessageParams } from "./messages.js";

// Error classes
export { ApiError, ConnectionError, AuthenticationError, NotFoundError, ClientNotConfiguredError } from "./classes.js";

// Validation error (fold-in — see errors/factory.ts note)
export { ValidationError, type ValidationErrorOptions, type ValidationIssue } from "./validation.js";

// Error extraction
export { formatError, extractKomodoError, isAuthRejection } from "./extraction.js";

// Factory
export { AppErrorFactory, type AppErrorFactoryType } from "./factory.js";

// Base error class + supporting types (local port of mcp-server-framework's AppError)
export { AppError, type BaseErrorOptions, type SerializedError } from "./app-error.js";

// Error codes / HTTP status (local port of mcp-server-framework's error-codes/http tables)
export {
  ErrorCodes,
  HttpStatus,
  ErrorCodeToHttpStatus,
  getHttpStatusForErrorCode,
  type ErrorCodeType,
  type HttpStatusType,
} from "./error-codes.js";
