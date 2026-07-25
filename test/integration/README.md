# Integration tests

These tests talk to a **real, running Komodo Core instance** and create/destroy
**real disposable resources** (tags, user groups, stacks, deployments, etc.).
They are never run by `npm test` — invoke them explicitly:

```bash
npm run test:integration
```

That script loads `.env` via `node --env-file=.env`. Point it at a **throwaway
Komodo server you control**, not production.

## Required environment

| Variable | Needed for | Notes |
|---|---|---|
| `KOMODO_URL` | all suites | without it, every integration suite skips |
| `KOMODO_API_KEY` / `KOMODO_API_SECRET` | all suites | key-based auth |
| `KOMODO_TEST_SERVER_ID` | server-scoped suites (Stack, Deployment, Builder, Permission, read-only) | object id of a Komodo Server the tests target; find it via `komodo_server_list`. Server-scoped suites skip if unset |
| `GITEA_URL` / `GITEA_TOKEN` / `GITEA_TEST_ORG` / `GITEA_TEST_REPO` | Provider/Repo/Builder coverage that needs a git host | optional; the suites that need them skip if unset |

Every disposable resource these tests create is prefixed `kmcp-itest-<domain>-`
plus a random suffix, so leftovers are easy to spot and clean up if a run is
interrupted mid-lifecycle.

## Suites that need a privileged credential

A few assertions (e.g. `komodo_permission_update_user_base` requiring Super
Admin) verify that Komodo correctly *rejects* an under-privileged call. They pass
with an ordinary admin credential — the rejection is the expected outcome. No
super-admin credential is required to run the suite.
