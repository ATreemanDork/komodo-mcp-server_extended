/**
 * UserGroup Renderers
 *
 * Markdown renderers for `komodo_user_group_*` tool responses.
 *
 * No reference-repo file to port from — modeled on `tools/renderers/tag.ts`,
 * the closest existing analog (small resource, no resource-link offload).
 *
 * @module tools/renderers/user-group
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { jsonBlock } from "./_shared.js";

interface UserGroupItem {
  readonly id: string;
  readonly name: string;
  readonly everyone?: boolean;
  readonly users?: readonly string[];
}

export function renderUserGroupList(payload: { items: readonly UserGroupItem[] }): string {
  const { items } = payload;
  const header = `${RESPONSE_ICONS.USER_GROUP} User Groups (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo user groups configured.`;
  const rows = items
    .map((g) => {
      const flags: string[] = [];
      if (g.everyone) flags.push("everyone");
      flags.push(`${String(g.users?.length ?? 0)} member(s)`);
      return `• ${g.name} (${g.id}) — ${flags.join(", ")}`;
    })
    .join("\n");
  return `${header}\n\n${rows}`;
}

export function renderUserGroupInfo(payload: { user_group: UserGroupItem }): string {
  const header = `${RESPONSE_ICONS.INFO} UserGroup "${payload.user_group.name}"`;
  return `${header}\n\n${jsonBlock(payload.user_group)}`;
}
