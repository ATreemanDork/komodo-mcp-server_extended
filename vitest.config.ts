/**
 * Vitest config — unit tier only.
 *
 * `npm test` must stay hermetic (no real Komodo connection, safe to run
 * anywhere/anytime) — explicitly scoped to `test/unit/**` so it can never
 * accidentally sweep up `test/integration/**` (which talks to a real
 * instance and creates/destroys real disposable resources). See
 * `vitest.integration.config.ts` for that tier, invoked separately via
 * `npm run test:integration`.
 *
 * @module vitest.config
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
  },
});
