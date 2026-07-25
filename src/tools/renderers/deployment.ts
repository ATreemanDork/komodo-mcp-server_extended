/**
 * Deployment Renderers
 *
 * Markdown renderers for `komodo_deployment_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderDeploymentList`/`renderDeploymentInfo`) — pulls its primitives
 * (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/deployment
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface DeploymentListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly server_id?: string;
}

export function renderDeploymentList(payload: { items: readonly DeploymentListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.DEPLOYMENT} Deployments (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo deployments found.`;
  const rows = items
    .map((d) => {
      const server = d.server_id ? ` | Server: ${d.server_id}` : "";
      return `• ${d.name} (${d.id}) — State: ${stateBadge(d.state)}${server}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface DeploymentInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderDeploymentInfo(payload: DeploymentInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Deployment "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull deployment resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
