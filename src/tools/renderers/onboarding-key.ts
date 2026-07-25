/**
 * OnboardingKey Renderers
 *
 * Markdown renderer for `komodo_onboarding_key_list` tool responses.
 * `komodo_onboarding_key_apply` / `komodo_onboarding_key_delete` reuse the
 * generic `buildApplyResult`/`buildDeleteResult` text from
 * `utils/response-formatter.ts` (same as `tools/alerter.ts`) — no
 * domain-specific renderer needed for those.
 *
 * Genuinely new construction — no reference-repo file to port from. Modeled
 * on `renderers/alerter.ts`'s list renderer, the closest existing analog.
 *
 * @module tools/renderers/onboarding-key
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, type PageInfo } from "./_shared.js";

interface OnboardingKeyListItem {
  readonly public_key: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly expires?: number;
  readonly onboarded?: readonly string[];
}

export function renderOnboardingKeyList(payload: { items: readonly OnboardingKeyListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.ONBOARDING_KEY} Onboarding keys (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo onboarding keys configured.`;
  const rows = items
    .map((k) => {
      const label = k.name ?? k.public_key;
      const enabled = k.enabled === undefined ? "" : k.enabled ? " | enabled" : " | disabled";
      const expires =
        k.expires === undefined ? "" : k.expires === 0 ? " | never expires" : ` | expires ${String(k.expires)}`;
      const onboarded = k.onboarded?.length ? ` | ${String(k.onboarded.length)} server(s) onboarded` : "";
      return `• ${label} (${k.public_key})${enabled}${expires}${onboarded}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}
