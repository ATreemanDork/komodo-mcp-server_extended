/**
 * Permission Renderers
 *
 * Markdown renderers for `komodo_permission_*` tool responses.
 *
 * No reference-repo file to port from — modeled on
 * `tools/renderers/tag.ts`'s plain list/info rendering style, adapted for
 * Permission's RBAC-matrix shape (no single "resource" per entry).
 *
 * @module tools/renderers/permission
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { jsonBlock } from "./_shared.js";

interface UserTargetLike {
  readonly type: string;
  readonly id: string;
}

interface ResourceTargetLike {
  readonly type: string;
  readonly id: string;
}

interface PermissionEntryLike {
  readonly id?: string;
  readonly user_target: UserTargetLike;
  readonly resource_target: ResourceTargetLike;
  readonly level?: string;
  readonly specific?: readonly string[];
}

function formatEntry(p: PermissionEntryLike): string {
  const specific = p.specific && p.specific.length > 0 ? ` +[${p.specific.join(", ")}]` : "";
  return `• ${p.user_target.type}:${p.user_target.id} → ${p.resource_target.type}:${p.resource_target.id} = ${p.level ?? "None"}${specific}`;
}

export function renderPermissionGet(payload: {
  target: ResourceTargetLike;
  level: string;
  specific: readonly string[];
}): string {
  const header = `${RESPONSE_ICONS.PERMISSION} Your permission on ${payload.target.type}:${payload.target.id}`;
  const specific = payload.specific.length > 0 ? ` +[${payload.specific.join(", ")}]` : "";
  return `${header}\n\n**${payload.level}**${specific}`;
}

export function renderPermissionList(payload: { items: readonly PermissionEntryLike[] }): string {
  const { items } = payload;
  const header = `${RESPONSE_ICONS.PERMISSION} Permissions (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo permission entries found.`;
  return `${header}\n\n${items.map(formatEntry).join("\n")}`;
}

export function renderPermissionUpdate(payload: Record<string, unknown>): string {
  const header = `${RESPONSE_ICONS.SUCCESS} Permission updated`;
  return `${header}\n\n${jsonBlock(payload)}`;
}
