/**
 * String Interpolation Helper
 *
 * Local copy of the one function (and its param type) that errors/
 * messages.ts needs from mcp-server-framework's utils/string-helpers
 * module. Ported verbatim — framework-agnostic, ~10 lines — since the
 * framework package itself is no longer a dependency.
 *
 * @module errors/interpolate
 */

export type MessageParams = Record<string, string | number | boolean | undefined>;

const INTERPOLATION_REGEX = /\{(\w+)\}/g;

export function interpolate(template: string, params: MessageParams): string {
  INTERPOLATION_REGEX.lastIndex = 0;
  return template.replace(INTERPOLATION_REGEX, (match: string, key: string) => {
    const value = params[key];
    if (value === undefined) return match;
    return String(value);
  });
}
