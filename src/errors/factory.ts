/**
 * Application Error Factory
 *
 * Centralized error creation for Komodo-specific errors.
 *
 * DEVIATION: the reference factory.ts also re-exported framework-level
 * namespaces (mcp, session, transport, validation, configuration,
 * operation, cancellation, internal, registry, normalize, isAppError) by
 * delegating to mcp-server-framework's `FrameworkErrorFactory`. None of
 * that is used by client.ts, and rebuilding that whole error taxonomy
 * (McpProtocolError, SessionError, TransportError, ValidationError, etc.)
 * belongs to the src/mcp//src/server bootstrap built in later steps, not
 * this one — so this port keeps only the Komodo-specific namespaces
 * (api, connection, auth, notFound, client, getMessage). Add the
 * framework-equivalent namespaces here (or in a sibling factory) once a
 * later step actually needs them.
 *
 * FOLD-IN: `validation` added — the reference's
 * apply-tool required-field checks (`AppErrorFactory.validation.
 * fieldRequired(...)`) need it. Ported from the framework's `ValidationError`
 * (see `./validation.js`), not stubbed.
 *
 * @module errors/factory
 */

import type { ZodError } from "zod";
import { ApiError, ConnectionError, AuthenticationError, NotFoundError, ClientNotConfiguredError } from "./classes.js";
import { getAppMessage } from "./messages.js";
import { ValidationError } from "./validation.js";

export const AppErrorFactory = {
  validation: {
    fieldRequired: (field: string) => ValidationError.fieldRequired(field),
    fieldInvalid: (field: string, value?: unknown) => ValidationError.fieldInvalid(field, value),
    fieldTypeMismatch: (field: string, expectedType: string) => ValidationError.fieldTypeMismatch(field, expectedType),
    fieldMin: (field: string, min: number) => ValidationError.fieldMin(field, min),
    fieldMax: (field: string, max: number) => ValidationError.fieldMax(field, max),
    fieldPattern: (field: string) => ValidationError.fieldPattern(field),
    fromZodError: (error: ZodError, message?: string) => ValidationError.fromZodError(error, message),
  },

  // Komodo-specific errors
  api: {
    requestFailed: (reason?: string) => ApiError.requestFailed(reason),
    fromResponse: (status: number, message: string, endpoint?: string) =>
      ApiError.fromResponse(status, message, endpoint),
    invalidResponse: (reason?: string) => ApiError.invalidResponse(reason),
    parseError: (cause?: Error) => ApiError.parseError(cause),
    custom: (message: string, options?: { endpoint?: string; apiStatusCode?: number }) =>
      new ApiError(message, options),
  },

  connection: {
    failed: (target: string, reason?: string) => ConnectionError.failed(target, reason),
    refused: (target: string) => ConnectionError.refused(target),
    timeout: (target: string) => ConnectionError.timeout(target),
    custom: (message: string, target: string) => new ConnectionError(message, target),
  },

  auth: {
    failed: (reason?: string) => AuthenticationError.failed(reason),
    invalidCredentials: () => AuthenticationError.invalidCredentials(),
    tokenExpired: () => AuthenticationError.tokenExpired(),
    tokenInvalid: () => AuthenticationError.tokenInvalid(),
    unauthorized: () => AuthenticationError.unauthorized(),
    forbidden: () => AuthenticationError.forbidden(),
    custom: (message: string) => new AuthenticationError(message),
  },

  notFound: {
    resource: (resource: string, type?: string) => NotFoundError.resource(resource, type),
    server: (server: string) => NotFoundError.server(server),
    container: (container: string) => NotFoundError.container(container),
    stack: (stack: string) => NotFoundError.stack(stack),
    deployment: (deployment: string) => NotFoundError.deployment(deployment),
  },

  client: {
    notConfigured: () => ClientNotConfiguredError.notConfigured(),
    notConnected: () => ClientNotConfiguredError.notConnected(),
    invalidConfiguration: (reason: string) => ClientNotConfiguredError.invalidConfiguration(reason),
    custom: (message: string) => new ClientNotConfiguredError(message),
  },

  getMessage: getAppMessage,
} as const;

export type AppErrorFactoryType = typeof AppErrorFactory;
