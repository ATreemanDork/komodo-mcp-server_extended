/**
 * API Helpers
 *
 * Minimal port of the reference repo's `utils/api-helpers.ts` — only what
 * `komodo_server_list` needs: client access (`requireClient`) and API-error
 * classification (`wrapApiCall`). Pagination, polling, and the other
 * utilities in the reference `utils/*` belong to the full
 * 16-domain tool surface port, not this one-tool build.
 *
 * DEVIATION from the reference: the reference's `wrapApiCall` also checks
 * `OperationCancelledError` from `mcp-server-framework` and takes an
 * `AbortSignal` to support mid-call cancellation. That framework type has
 * no local equivalent yet (cancellation support belongs to a later step
 * once the guardrail/task layer needs it) — this port keeps only the
 * Komodo-error-classification behavior (network/timeout/auth/HTTP mapping).
 *
 * @module utils/api-helpers
 */

import type { KomodoClient } from "../client.js";
import { komodoConnection } from "../client.js";
import { ApiError, AuthenticationError, ConnectionError, extractKomodoError } from "../errors/index.js";
import { AppErrorFactory } from "../errors/index.js";

/** Connection-related Node.js error codes */
const CONNECTION_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ERR_NETWORK"]);

/** Timeout-related Node.js error codes */
const TIMEOUT_ERROR_CODES = new Set(["ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * Returns the connected Komodo client.
 * Throws `ClientNotConfiguredError` with a state-aware message if not connected.
 */
export function requireClient(): KomodoClient {
  const client = komodoConnection.getClient();
  if (!client) {
    throw AppErrorFactory.client.notConfigured();
  }
  return client;
}

/** Extracts the HTTP status code from a komodo_client plain-object rejection. */
function getKomodoStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const status = (error as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Extracts a Node.js error code from an Error instance, including nested cause chains.
 * Node.js fetch wraps the real error (ECONNREFUSED, etc.) in error.cause.
 */
function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code) return code;
    if (error.cause instanceof Error) {
      return (error.cause as Error & { code?: string }).code;
    }
  }
  return undefined;
}

/**
 * Wraps a Komodo API call, translating `komodo_client`'s plain-object
 * rejections (HTTP errors: `{ status, result: { error } }`; network errors:
 * `{ status: 1, error: <Error> }`) and raw Node.js errors into the local
 * `AppError` hierarchy.
 */
export async function wrapApiCall<T>(operation: string, apiCall: () => Promise<T>): Promise<T> {
  try {
    return await apiCall();
  } catch (error) {
    if (error instanceof ApiError || error instanceof ConnectionError || error instanceof AuthenticationError) {
      throw error;
    }

    const status = getKomodoStatus(error);
    if (status !== undefined) {
      const message = extractKomodoError(error);

      if (status === 1) {
        throw ConnectionError.failed(operation, message);
      }
      if (status === 401) {
        throw AuthenticationError.unauthorized();
      }
      if (status === 403) {
        throw AuthenticationError.forbidden();
      }
      if (status >= 400) {
        throw ApiError.fromResponse(status, message);
      }
    }

    if (error instanceof Error) {
      const code = getErrorCode(error);

      if (code && CONNECTION_ERROR_CODES.has(code)) {
        throw ConnectionError.failed(operation, `${code}: ${error.message}`);
      }
      if (code && TIMEOUT_ERROR_CODES.has(code)) {
        throw ConnectionError.timeout(operation);
      }
      if (error.message.includes("timeout") || error.name === "TimeoutError") {
        throw ConnectionError.timeout(operation);
      }

      throw ApiError.requestFailed(`${operation}: ${error.message}`);
    }

    throw ApiError.requestFailed(`${operation}: ${String(error)}`);
  }
}
