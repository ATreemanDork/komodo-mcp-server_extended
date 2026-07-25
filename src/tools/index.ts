/**
 * Tool Modules
 *
 * Importing this module runs every tool file's top-level
 * `registerToolDefinition()` call (see e.g. `./server.js`), populating the
 * in-process registry (`src/mcp/registry.ts`) that `create-server.ts`
 * enumerates. Add each new tool domain file's import here as it's ported
 * — this file is the single place that lists them.
 *
 * @module tools/index
 */

import "./server.js";
import "./deployment.js";
import "./stack.js";
import "./build.js";
import "./repo.js";
import "./action.js";
import "./procedure.js";
import "./update.js";
import "./terminal.js";
import "./swarm.js";
import "./container.js";
import "./config.js";
import "./user.js";
import "./variable.js";
import "./alerter.js";
import "./resource-sync.js";
import "./docker.js";
import "./tag.js";
import "./onboarding-key.js";
import "./builder.js";
import "./git-provider.js";
import "./docker-registry.js";
import "./user-group.js";
import "./permission.js";
import "./toml.js";
