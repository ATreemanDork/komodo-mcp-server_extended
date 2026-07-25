/**
 * Error Codes & HTTP Status
 *
 * Local copies of two data tables from mcp-server-framework's
 * errors/core module (`ErrorCodes`, `HttpStatus`, and the code→status
 * mapping) that classes.ts and app-error.ts depend on. Ported verbatim —
 * they are plain string/number const maps with no framework dependency of
 * their own — since the framework package itself is no longer a
 * dependency of this project.
 *
 * @module errors/error-codes
 */

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_REQUEST: "INVALID_REQUEST",
  API_ERROR: "API_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  REGISTRY_ERROR: "REGISTRY_ERROR",
  OPERATION_CANCELLED: "OPERATION_CANCELLED",
  OPERATION_ERROR: "OPERATION_ERROR",
  API_CLIENT_NOT_CONFIGURED: "API_CLIENT_NOT_CONFIGURED",
  API_AUTHENTICATION_ERROR: "API_AUTHENTICATION_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const HttpStatus = {
  OK: 200,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONFLICT: 409,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

export type HttpStatusType = (typeof HttpStatus)[keyof typeof HttpStatus];

export const ErrorCodeToHttpStatus: Record<string, HttpStatusType> = {
  [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.INVALID_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCodes.CONFIGURATION_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCodes.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCodes.API_ERROR]: HttpStatus.BAD_GATEWAY,
  [ErrorCodes.SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCodes.TIMEOUT_ERROR]: HttpStatus.GATEWAY_TIMEOUT,
  [ErrorCodes.REGISTRY_ERROR]: HttpStatus.NOT_FOUND,
  [ErrorCodes.OPERATION_CANCELLED]: HttpStatus.CLIENT_CLOSED_REQUEST,
  [ErrorCodes.OPERATION_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCodes.API_CLIENT_NOT_CONFIGURED]: HttpStatus.PRECONDITION_REQUIRED,
  [ErrorCodes.API_AUTHENTICATION_ERROR]: HttpStatus.UNAUTHORIZED,
};

export function getHttpStatusForErrorCode(code: ErrorCodeType): HttpStatusType {
  return ErrorCodeToHttpStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
}
