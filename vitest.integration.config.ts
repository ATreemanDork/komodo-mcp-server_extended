/**
 * Vitest config — integration tier.
 *
 * Talks to a REAL Komodo instance (point it at a disposable test server you
 * control via `KOMODO_TEST_SERVER_ID`) and creates/destroys real disposable
 * resources (Tag, UserGroup, Stack, ...). Never runs as part of `npm test`
 * — invoke explicitly via `npm run test:integration`, which loads `.env`
 * via `node --env-file=.env`. Individual files skip themselves (via
 * `describe.skipIf`) if their specific prerequisite env var isn't set.
 *
 * Longer default timeout than the unit config — real API calls, and a
 * handful of tests poll a lifecycle action (deploy/destroy) to completion.
 *
 * @module vitest.integration.config
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Real Komodo state (Tag/UserGroup names, etc.) isn't file-isolated the
    // way mocked unit tests are — run integration files serially to avoid
    // two files racing on shared list/count assertions.
    fileParallelism: false,
  },
});
