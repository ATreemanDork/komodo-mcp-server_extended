/**
 * Polling Utilities
 *
 * Execute-and-poll workflow for long-running Komodo operations. Polls
 * `komodo_client.execute()` results until the operation completes, with
 * timeout enforcement on top.
 *
 * DEVIATION from the reference: the reference's version also accepts an
 * `AbortSignal` for cancellation and a `ProgressReporter` for MCP progress
 * notifications, both sourced from `mcp-server-framework`
 * (`OperationCancelledError`, the `ProgressReporter` type) which has no
 * local equivalent yet — same deviation already made in
 * `utils/api-helpers.ts`'s `wrapApiCall` for the same reason. Cancellation
 * and progress-reporting support belong to a later step once the
 * guardrail/task layer needs them.
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/utils/polling.ts).
 *
 * @module utils/polling
 */

import { Types } from "komodo_client";
import type { KomodoClient } from "../client.js";
import { ApiError } from "../errors/index.js";
import { requireClient, wrapApiCall } from "./api-helpers.js";

type Update = Types.Update;

// ============================================================================
// Polling Constants
// ============================================================================

/** Interval between status polls (ms) */
const POLL_INTERVAL_MS = 1_000;

/** Maximum time to wait for an operation to complete (30 minutes) */
const POLL_MAX_DURATION_MS = 1_800_000;

// ============================================================================
// Update Helpers
// ============================================================================

/**
 * Extract the MongoDB ObjectId string from a Komodo Update object.
 */
export function extractUpdateId(update: { _id?: { $oid?: string } }): string {
  return update._id?.$oid || "unknown";
}

// ============================================================================
// Polling
// ============================================================================

/**
 * Polls a Komodo update until its status reaches `Complete`.
 *
 * Komodo updates follow the lifecycle `Queued → InProgress → Complete`.
 *
 * @param client    - Komodo API client
 * @param updateId  - The `_id.$oid` of the Update returned by `execute()`
 * @param operation - Human-readable operation name (for error messages)
 * @returns The final Update with `status === "Complete"`
 */
async function pollUntilComplete(client: KomodoClient, updateId: string, operation: string): Promise<Update> {
  const startTime = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional polling loop, exits via return or throw
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const elapsed = Date.now() - startTime;

    // Enforce maximum timeout
    if (elapsed > POLL_MAX_DURATION_MS) {
      throw ApiError.requestFailed(
        `${operation}: polling timed out after ${String(Math.round(elapsed / 1000))}s (update: ${updateId})`,
      );
    }

    // Poll status
    const update = await wrapApiCall(`${operation} (poll)`, () => client.client.read("GetUpdate", { id: updateId }));

    if (update.status === Types.UpdateStatus.Complete) {
      return update;
    }
  }
}

/**
 * Executes a Komodo action and polls until the operation completes.
 *
 * Replaces the direct use of `komodo_client.execute_and_poll()` to add
 * maximum timeout enforcement on top of the underlying poll. For instant
 * operations (status already `Complete` after `execute()`), the polling
 * loop is skipped entirely.
 */
export async function wrapExecuteAndPoll(operation: string, executeCall: () => Promise<Update>): Promise<Update> {
  const client = requireClient();

  const update = await wrapApiCall(operation, executeCall);

  // If already complete, skip polling
  if (update.status === Types.UpdateStatus.Complete) {
    return update;
  }

  // Poll until complete
  const updateId = extractUpdateId(update);
  return await pollUntilComplete(client, updateId, operation);
}

// ============================================================================
// Action Result Payload
// ============================================================================

/**
 * Typed `actionResultSchema`-shaped payload built from a completed Update.
 */
export interface ActionResult {
  readonly success: boolean;
  readonly status: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly server?: string;
  readonly version?: string;
  readonly [key: string]: unknown;
}

export function buildActionResult(
  update: Update,
  action: string,
  resourceType: string,
  resourceId: string,
  serverName?: string,
): ActionResult {
  const version = update.version
    ? `${String(update.version.major)}.${String(update.version.minor)}.${String(update.version.patch)}`
    : undefined;

  return {
    success: update.success,
    status: update.status,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    ...(serverName !== undefined ? { server: serverName } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}
