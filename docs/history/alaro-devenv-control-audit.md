# Alaro `devenv_control` source audit

## Scope and source baseline

This audit covers every file under `app/devenv_control` in `alaro-ai/alaro` at commit [`44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf`](https://github.com/alaro-ai/alaro/tree/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control), the `main` commit inspected on 2026-07-12. Links below are commit-pinned primary-source links.

The supplied screenshot is an older state. Current `main` already contains several of the requested improvements: a combined status/toggle + instance selector, row actions only in an overflow menu, partial Apps health, React Query, a worktree view toggle, workspace actions, a resizable diagnostics panel, and a refresh-progress overlay.

## Executive summary

The Alaro tool is a loopback-only Node/Vite control server plus a React SPA. It discovers Git worktrees, reads `.env.instance`, calculates two fixed banks of ports (Apps and Devenv), polls actual listeners, tracks commands started by the server in memory, persists managed app PIDs and logs under `~/.alaro-dev-control`, and exposes start/stop/config/worktree operations through JSON endpoints. The client polls instance state every 10 seconds and selected-instance logs every 2.5 seconds.

Its strongest reusable ideas are:

- Git-native worktree discovery through `git worktree list --porcelain`.
- A combined primary action and slot selector.
- Port-derived stopped/partial/running health, including a detailed per-port hover card.
- Process ownership checks before killing a PID.
- Server-side action validation plus client-side pending/disabled states.
- Query invalidation after mutations, automatic polling, window-focus refresh, and schema validation at the API boundary.
- Managed command history, logs, bulk stop, worktree creation/deletion, environment-file propagation, and a persisted resizable diagnostic panel.

The core limitation is that configuration and commands are not generic. Repo validation expects Alaro marker files, worktree naming expects `alaro-N`, slot counts and every port are hard-coded, configuration is read/written through Alaro's `.env.instance` shell helpers, and all operational commands call Alaro-specific `pnpm` scripts. The backend is also a 1,505-line monolith, while all shell command builders share one file.

## Architecture and data flow

1. `scripts/daemon.mjs` starts `src/server.mjs` detached on `127.0.0.1:3999`, persists a PID and server log, and provides `start`, `status`, and `stop` CLI operations ([daemon lines 6-16](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/scripts/daemon.mjs#L6-L16), [66-97](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/scripts/daemon.mjs#L66-L97), [99-152](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/scripts/daemon.mjs#L99-L152)).
2. `src/server.mjs` runs an HTTP server and Vite in middleware mode. API routes are handled first; everything else goes to the Vite SPA ([server lines 1418-1505](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1418-L1505)).
3. Each `GET /api/instances` recomputes discovery, repo status, env configuration, port listeners, app/devenv state, deletability, and tracked process summaries ([server lines 553-629](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L553-L629)).
4. The SPA validates every response with Zod, polls state with TanStack React Query, and invalidates instance and log queries after mutations ([api lines 21-89](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/api.ts#L21-L89), [query hook lines 9-54](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-queries.ts#L9-L54), [action hook lines 21-205](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-actions.ts#L21-L205)).
5. Selecting a row opens a horizontally resizable detail panel containing port health, actions, recent processes, and managed terminal output ([app lines 51-136](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/app.tsx#L51-L136)).

## Data model and state semantics

### Repository/worktree identity

An `InstanceInfo` includes:

- repository identity: `repoName`, `repoPath`, `branch`, `repoPresent`, `repoSource`, and `repoStatus`;
- identity/config: `expectedInstance`, `serverInstance`, `configuredAppsInstance`, and `configuredDevenvInstance`;
- configuration: `apps` and `dev` port maps;
- live state: `appState`, `devenvState`, `listeningAppPorts`, and `listeningDevPorts`;
- behavior flags: `appsMapped`, `canDeleteWorktree`;
- tracked command state: `processes`.

The complete schema is in [`api-schemas.ts` lines 58-84](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/api-schemas.ts#L58-L84). Responses and client-side types are inferred from these Zod schemas rather than maintained independently ([types lines 1-31](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/types.ts#L1-L31)).

`expectedInstance` is overloaded: inferred Alaro worktrees get IDs `0..9`, while worktrees that do not match the naming convention receive transient IDs starting at `10,000` on each discovery. That means these IDs are not stable across topology changes. `serverInstance` is simply the parsed `APPS_INSTANCE`; `configuredAppsInstance` duplicates it ([server lines 274-337](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L274-L337), [553-585](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L553-L585)).

### Apps health

Backend `appState` has only `listening | stopped`; it becomes `listening` when at least one repo-owned configured app port is listening ([server lines 615-625](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L615-L625)). The row derives the more useful three-state health:

- inactive: zero configured app ports listen;
- partial: at least one but not all configured app ports listen;
- active: all configured app ports listen.

That derivation is explicit in [`instance-table-row.tsx` lines 38-67](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table-row.tsx#L38-L67). The status card lists each running and missing port ([app status card lines 9-31](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/app-status-hover-card.tsx#L9-L31), [generic port status card lines 39-65](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/port-status-hover-card.tsx#L39-L65)).

Important nuance: the toggle treats **any** listening app port as “running,” so clicking the Apps button in partial state stops, rather than attempting to start the missing apps ([row lines 38-45](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table-row.tsx#L38-L45)).

### Devenv health

Devenv has `listening`, `partial`, `in-use`, and `not-detected`. `in-use` means another worktree configured for the same shared devenv slot has listeners; unlike Apps, port ownership is not tied to the repo ([server lines 591-613](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L591-L613)). This entire model is out of scope for the generic app per requested change 4.

### Process state

Tracked processes are a discriminated union of `running`, `completed`, and `failed`; they carry action, command, timestamps, PID, exit code/signal, label, and message ([api schemas lines 27-56](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/api-schemas.ts#L27-L56)). Tracking is memory-only, except app-root PIDs and log files. Completed/failed records expire after five minutes and only eight records per instance are retained; running records are retained ([server lines 35-39](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L35-L39), [677-709](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L677-L709)). A control-server restart therefore loses command history and live process metadata, though it can recover a persisted start-apps PID.

## Discovery and genericity audit

### Reusable behavior

- Uses `git worktree list --porcelain`, ignoring prunable or missing paths and preserving branch/detached-HEAD labels ([server lines 175-229](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L175-L229)).
- Supports an explicit main repo through `ALARO_DEV_CONTROL_MAIN_REPO`, with `~` expansion ([server lines 63-73](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L63-L73), [213-224](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L213-L224)).
- Shows either only worktrees mapped to known instances or all discovered worktrees, with the choice persisted in local storage ([worktree view mode lines 6-34](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/worktree-view-mode.ts#L6-L34)).
- Sorts inferred slots first, then other paths lexicographically ([server lines 258-272](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L258-L272)).

### Alaro-specific assumptions to remove or configure

- Main repo defaults to the monorepo that contains the control app; code root defaults to its parent ([server lines 26-31](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L26-L31)). The new app's primary input is instead an arbitrary local repo path.
- Fallback discovery assumes sibling folders named `alaro`, `alaro-1` ... `alaro-9`; instance inference also matches only `^alaro-(\d+)$` ([server lines 75-81](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L75-L81), [231-255](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L231-L255)).
- Repo validity requires both `package.json` and `pnpm-workspace.yaml`, plus the path must exactly equal Git's top-level path; error text says “Alaro” ([server lines 40-41](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L40-L41), [153-168](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L153-L168), [884-907](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L884-L907)).
- App slots are fixed at ten; devenv slots at four ([server lines 32-34](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L32-L34), [client constants lines 1-17](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/constants.ts#L1-L17)).
- `.env.instance` is parsed as simple unquoted `KEY=value` lines. Apps use `APPS_INSTANCE`; infrastructure uses `DEVENV_INSTANCE` ([server lines 130-146](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L130-L146), [553-567](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L553-L567)).
- Slot assignment calls functions from `scripts/env-instance.sh`, so it cannot work in another repo without an adapter ([command builders lines 37-53](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/scripts/dev-control-scripts.mjs#L37-L53)).
- Four Apps port roles and nine Devenv port roles are fixed and computed from fixed bases/offsets ([server lines 84-107](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L84-L107)).
- Only `api` and `dashboard` get browser links, always using `http://127.0.0.1:<port>/` ([ports lines 1-29](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/ports.tsx#L1-L29)).
- Worktree creation delegates to `./scripts/worktree-setup.sh`; env propagation to `./scripts/worktree-propagate-files.sh`; app/infrastructure lifecycle and maintenance use Alaro-specific pnpm commands ([command builders lines 9-72](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/scripts/dev-control-scripts.mjs#L9-L72)).
- UI strings, local-storage keys, daemon files, env vars, package name, page title, and favicon are Alaro-branded ([constants lines 33-36](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/constants.ts#L33-L36), [index line 7](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/index.html#L7), [package lines 2-11](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/package.json#L2-L11)).

## Port detection and process safety

The current implementation already satisfies the intent of requested change 6, with caveats:

- It snapshots TCP listeners and UDP sockets using `lsof`; Docker published host ports are added from `docker ps` with a one-second timeout ([server lines 340-449](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L340-L449)).
- Apps count as listening only when a listener PID's current working directory is the worktree or is nested under it. This avoids claiming another repo's process that happens to use the same slot ([server lines 452-520](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L452-L520)).
- Devenv listeners are host-wide because infrastructure is shared by slot ([server lines 522-525](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L522-L525)).
- App stop first targets persisted/tracked detached process groups and then PIDs on every configured port. In both cases it refuses to kill PIDs whose cwd is outside the repo, logs skipped candidates, and returns killed/skipped PID arrays ([server lines 859-999](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L859-L999)).

Caveats for the generic design:

- `lsof` and the cwd-ownership technique are Unix/macOS-oriented. “PC” must be clarified: macOS only, macOS/Linux, or Windows too.
- Docker-published Apps ports are in the host-port set but have no PID/cwd mapping, so they will not be attributed to a worktree by `repoOwnedListeningAppPorts`.
- Listener existence is liveness, not application readiness. No HTTP/TCP health check semantics exist beyond “port is bound.”
- Ownership by current working directory can fail for wrappers/daemons that chdir elsewhere, and can be ambiguous for containers.
- Stop sends `SIGTERM` and returns immediately; unlike daemon stop, app stop has no wait/escalate-to-`SIGKILL` cycle.

## Commands and operational behavior

### Command catalogue

| Action | Current command/behavior | Execution model | Generic disposition |
| --- | --- | --- | --- |
| `start-apps` | `pnpm turbo run dev dev:worker dev:temporal-worker --filter=!alaro-dev-control` | Detached, tracked, normally under `direnv exec` | Replace with repo-configured start command(s). |
| `stop-apps` | Kill tracked process group and repo-owned configured-port PIDs | Synchronous signal operation | Preserve ownership safety; define cross-platform process-tree behavior. |
| `set-apps-instance` | Source `scripts/env-instance.sh`, generate/write APPS section | Synchronous shell | Replace with a generic slot-env writer/config adapter. |
| `start-devenv` / `stop-devenv` / `cleanup-devenv` / `set-devenv-instance` | `pnpm devenv:*` or DEVENV env section | Detached except slot write | Remove. |
| `sync` | `pnpm sync` | Detached/tracked | Make optional/configured or omit from MVP. |
| `db-setup` | `pnpm db:setup` | Detached/tracked | Make optional/configured command. |
| `reload-direnv` | `direnv reload` | Synchronous | Optional capability; report unavailable when `direnv` missing. |
| `create-worktree` | `./scripts/worktree-setup.sh --instance N BRANCH` | Detached from main repo | Replace with generic `git worktree add` plus optional setup hooks. |
| `delete-worktree` | `git worktree remove PATH` | Detached from main repo | Reusable with dirty/running safeguards. |
| `propagate-env` | custom worktree propagation script, optional dry-run | Detached from main repo without `direnv` | Reimplement generically if retained. |

Primary source: [`dev-control-scripts.mjs` lines 1-73](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/scripts/dev-control-scripts.mjs#L1-L73).

### Execution lifecycle

Tracked commands spawn `bash -lc`, redirect stdout/stderr to a per-instance log, use `direnv exec` when installed, detach/unref the process, update an in-memory record on `error`/`exit`, and persist the start-apps root PID ([server lines 780-835](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L780-L835)). Synchronous configuration commands run with an eight-MiB buffer and return server errors on nonzero exit ([server lines 109-124](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L109-L124), [1242-1253](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1242-L1253)).

Start Apps is idempotent in three cases: a tracked start is running, a persisted managed PID is live, or all configured ports listen. It still starts when only some ports listen ([server lines 1017-1046](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1017-L1046)). This differs from the row toggle behavior noted above: the UI offers Stop in partial state even though the backend's Start could repair/relaunch it.

Configuration switching is rejected while any Apps or Devenv port listens or any tracked process runs. Apps slots are exclusive across discovered repos; Devenv slots are intentionally shareable ([server lines 745-774](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L745-L774), [1156-1168](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1156-L1168), [1255-1277](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1255-L1277)).

Deletion is allowed only for a real non-main Git worktree, with no app/devenv listeners and no running tracked command. The browser uses `window.confirm`; Git itself refuses dirty removal ([server lines 1323-1347](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1323-L1347), [row menu lines 29-52](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-actions.tsx#L29-L52)).

### API endpoints

| Method/path | Behavior |
| --- | --- |
| `GET /api/health` | `{ ok: true }` |
| `GET /api/instances` | Complete recomputed workspace state |
| `GET /api/instances/:id/logs` | Tail managed logs (default 10,000 lines; configurable up to 100,000) |
| `POST /api/instances/:id/actions/:action` | Lifecycle/maintenance/delete action |
| `POST /api/instances/:id/apps-instance` | Change Apps slot |
| `POST /api/instances/:id/devenv-instance` | Change Devenv slot |
| `POST /api/actions/stop-all-apps` | Stop all repos with a listener or tracked root |
| `POST /api/actions/stop-all-devenvs` | Stop all available devenvs not already transitioning |
| `POST /api/worktrees/create` | Create next available numbered worktree |
| `POST /api/worktrees/propagate-env` | Copy a relative file to worktrees, optionally dry-run |

Route source: [`server.mjs` lines 1424-1500](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1424-L1500).

## Complete UI behavior audit

### Toolbar

- Heading and code-root path.
- Persisted `Instances` / `All worktrees` toggle. “Instances” means `serverInstance !== null`, not necessarily a folder whose inferred index matches its configured slot ([toolbar lines 50-76](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/control-toolbar.tsx#L50-L76), [view predicate lines 8-14](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/worktree-view-mode.ts#L8-L14)).
- `Worktrees` menu with “New worktree” and “Propagate to worktrees” dialogs ([workspace menu lines 23-71](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/workspace-actions-menu.tsx#L23-L71)).
- Refresh button with spinner while fetching and an animated background countdown. The animation is keyed by `updatedAt`, scales from `1` to `0`, and has a left transform origin—therefore its right edge moves left, exactly the requested direction ([toolbar lines 24-43](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/control-toolbar.tsx#L24-L43), [77-92](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/control-toolbar.tsx#L77-L92), [styles lines 711-750](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/styles.css#L711-L750)).
- Current poll interval is 10 seconds, not requested default 30 seconds ([constants lines 33-35](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/constants.ts#L33-L35)).
- A relative “Updated N seconds ago” formatter exists but is unused by the current toolbar, so the screenshot's text no longer renders ([formatting lines 28-39](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/formatting.ts#L28-L39)).

### Main table

Columns are Repository, Branch, Apps, Devenv, Ports, and Actions. Apps and Devenv header menus each expose a bulk stop action ([table lines 47-91](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table.tsx#L47-L91), [103-127](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table.tsx#L103-L127)).

Each row:

- is clickable/focusable and opens details;
- shows worktree name/path and branch, detached SHA, `missing`, or `not an Alaro repo`;
- has a combined Apps primary button + chevron selector;
- has the equivalent Devenv control;
- links the API/dashboard ports only when they are actually listening;
- puts Open terminal, Sync, Cleanup devenv, Reload direnv, DB setup, and Delete worktree inside the overflow menu.

Sources: [`instance-table-row.tsx` lines 71-139](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table-row.tsx#L71-L139), [`instance-actions.tsx` lines 54-104](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-actions.tsx#L54-L104).

The combined selector already implements requested changes 7 and 8 structurally: clicking the main Apps half starts/stops; clicking the chevron opens slots. It handles a configured value outside the hard-coded option set by prepending it, marks only the current option disabled/checked, and does **not** show a slot's ports or whether another worktree occupies it ([instance selector lines 33-118](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-selector.tsx#L33-L118)).

The old screenshot's `mapped` subtitle is no longer rendered. `appsMapped` remains in the server model/schema but has no client use, making it removable unless the generic spec restores a concept of expected folder-to-slot mapping.

### Workspace dialogs

- New worktree chooses the first unoccupied slot `1..9`, validates a non-empty branch in the client and a restricted branch character set in the server, previews `alaro-N`, then runs the custom setup script ([app lines 33-46](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/app.tsx#L33-L46), [create dialog lines 23-109](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/create-worktree-dialog.tsx#L23-L109), [server lines 1133-1213](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1133-L1213)).
- Propagate defaults to `.env`, rejects absolute/parent-traversal/control-character paths, clearly warns that real propagation overwrites, and supports dry-run ([propagate dialog lines 21-117](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/propagate-env-dialog.tsx#L21-L117), [server lines 1170-1229](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1170-L1229)).

### Detail panel and diagnostics

- Opens when a row is selected or an action begins; closes if filtering hides its instance.
- Horizontal split defaults to 62% main / 38% details, is constrained, and persists to local storage ([panel layout lines 7-45](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/panel-layout.ts#L7-L45)).
- Shows full Apps and Devenv running/missing port cards, direct start/stop controls for each, the maintenance menu, recent process rows, and terminal output ([instance panel lines 36-67](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-panel.tsx#L36-L67), [panel actions lines 94-177](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-panel-actions.tsx#L94-L177)).
- Process durations update every second; logs poll every 2.5 seconds, auto-scroll to the bottom, and can be copied with Clipboard API plus `execCommand` fallback ([use-now lines 3-11](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-now.ts#L3-L11), [terminal log lines 17-136](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/terminal-log.tsx#L17-L136)).

Potential interpretation conflict: requested change 7 says “Actions to only be a menu. Stop/start should happen on Apps button click.” The table already works this way, but the detail panel still presents direct Apps and Devenv Start/Stop buttons. The spec must clarify whether the detail panel remains and, if so, whether direct Apps start/stop controls there are acceptable.

## Loading, pending, error, empty, and accessibility behavior

- Initial instance loading renders eight skeleton rows ([skeleton lines 3-18](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table-skeleton.tsx#L3-L18)). There is no explicit empty-table state after a successful response with zero worktrees.
- Queries retry once, use 1.5-second staleness, and refetch on focus. Instances explicitly poll every 10 seconds; selected logs poll every 2.5 seconds ([query client lines 3-10](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/query-client.ts#L3-L10), [query hook lines 9-29](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-queries.ts#L9-L29)).
- Refresh calls instance and selected-log refetch concurrently. While fetching, the refresh button is disabled and spins ([query hook lines 37-39](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-queries.ts#L37-L39), [toolbar lines 77-92](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/control-toolbar.tsx#L77-L92)).
- Mutation state is tracked per `instance:action`, plus separate bulk Apps, bulk Devenv, and workspace flags. Every action catches errors into one global `lastError`; later actions clear it. Create/propagate rethrow so dialogs can show local errors too ([action hook lines 21-50](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-actions.ts#L21-L50), [73-205](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/hooks/use-instance-actions.ts#L73-L205)).
- Instance-query and action errors are persistent banners. There is no dismiss or per-row association ([app lines 88-90](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/app.tsx#L88-L90)).
- Server errors use `{ error: message }` and an attached `statusCode`, defaulting to 500. The client extracts this body and otherwise reports the HTTP status; malformed successful payloads surface as Zod errors ([server lines 1405-1416](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1405-L1416), [1498-1500](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/server.mjs#L1498-L1500), [api lines 21-40](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/api.ts#L21-L40)).
- Terminal has distinct loading, failure, empty, copied, and copy-failed states ([terminal log lines 50-109](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/terminal-log.tsx#L50-L109)).
- Buttons/menus include useful `aria-label`, `aria-busy`, and tooltip association. Rows are focusable, but have no keyboard activation handler, so Enter/Space does not open details. The custom hover card uses `role=tooltip` and is revealed by hover/focus-within ([row lines 71-76](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-table-row.tsx#L71-L76), [selector lines 55-117](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/components/instance-selector.tsx#L55-L117)).
- At widths below 900px the toolbar stacks but the table simply gets a 1,120px minimum width and horizontal scrolling; there is no mobile-specific row layout ([styles lines 1487-1500](https://github.com/alaro-ai/alaro/blob/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control/src/styles.css#L1487-L1500)).

## Requested changes mapped to current source

| # | Request | Current `main` | Spec consequence |
| --- | --- | --- | --- |
| 1 | Generic name/title, possibly a “tree organized” wordplay | Branding is Alaro throughout. | Decide product name before final UI copy, package IDs, storage keys, config directory, and env namespace. Candidate direction: **Treeboard**, **Treehouse**, **Worktree Control**, **Treeyard**, or **Arbor**. “Treeboard” communicates an organized control board most directly. |
| 2 | React Query; one command per file in `commands/` | React Query already handles queries/mutations/invalidation, but browser API functions are one `api.ts`, backend action logic is in `server.mjs`, and all command builders share `dev-control-scripts.mjs`. | Preserve React Query. Create a command contract/registry and one command module per operation; keep transport/API modules separate from executable commands. |
| 3 | Refresh overlay countdown right-to-left; default 30s or Query default; click refresh | Overlay behavior already exists and moves right-to-left, but polls at 10s and bypasses the otherwise global Query defaults with an explicit interval. | Change default to 30s, keep manual refetch, and have a single source of truth for interval/progress. Decide whether countdown pauses in background/offline and whether failed refetch resets it. |
| 4 | Apps slots only; remove Devenv | Current code has a full second slot system through server, schemas, UI, actions, port logic, bulk stop, dialogs, and state. | Remove it end-to-end, not just the column. This substantially simplifies config switching, deletion guards, panel layout, types, routes, and command catalogue. |
| 5 | Apps status only Not running / Partially running / Running; no “mapped” | Current row already derives inactive/partial/active and no longer renders “mapped”; `appsMapped` remains dead data. Button copy remains `Apps N`, with health encoded visually and details only in hover card. | Remove `appsMapped`; decide whether visible text should literally show status or whether the dot + Apps slot is sufficient. Define partial-click behavior. |
| 6 | Determine running from ports | Already implemented, with repo-cwd ownership for app listeners. | Generalize port definitions, platform strategy, and ownership. Decide whether “running” requires all ports, any port, readiness probes, or user-declared required/optional ports. |
| 7 | Actions only a menu; Start/Stop on Apps button click | Already true in table rows. Detail panel still has direct start/stop buttons. | Preserve table behavior; clarify panel behavior. Remove Sync as a dedicated action—the screenshot is stale and current source already did. |
| 8 | Apps combined button + selector; selector suggests other devslot ports | Combined control already exists, but menu lists only hard-coded `Apps N`; it neither displays ports nor filters/labels occupied slots. Backend rejects conflicts after selection. | Show computed slot/port previews and availability before mutation; define whether occupied slots are hidden, disabled with owner, or switchable via coordinated reassignment. |

## File-by-file inventory

### Runtime and configuration

| File | Responsibility | Reuse/genericity notes |
| --- | --- | --- |
| `index.html` | SPA root, viewport, favicon, Alaro page title. | Keep structure; replace brand assets/copy. |
| `package.json` | Daemon/lint/type/build scripts and React/Radix/Query/Vite/Zod dependencies. | Stack is reusable. No test script exists. |
| `tsconfig.json` | Strict browser TS config. | Reusable. |
| `public/favicon.svg` | Alaro favicon. | Replace. |
| `scripts/daemon.mjs` | Detached control-server lifecycle, PID/log files, health via `lsof`. | Useful local-app pattern; brand paths/env vars and Unix assumptions must change. |
| `src/server.mjs` | Discovery, validation, ports, process tracking, logs, actions, API, Vite. | Functionality is valuable but must be decomposed. It is the main genericity bottleneck. |
| `src/scripts/dev-control-scripts.mjs` | Shell quoting and every command builder. | Shell quoting reusable; commands all need per-file modules/adapters. |

### Client entry, API, and model

| File | Responsibility | Reuse/genericity notes |
| --- | --- | --- |
| `src/main.tsx` | Mount React and provide Query client. | Reuse. |
| `src/app.tsx` | Compose toolbar/table/details, filtering, selection, next slot, action/query state. | Reuse composition after removing Devenv. |
| `src/query-client.ts` | Query defaults: focus refetch, one retry, 1.5s stale time. | Reuse; define product defaults. |
| `src/query-keys.ts` | Instance and selected-log query keys. | Reuse concept; rename domain from “instance” if needed. |
| `src/api.ts` | Fetch wrapper, error extraction, Zod parse, all client endpoints. | Split by command/query if that is what “one command per file” includes. |
| `src/api-schemas.ts` | Zod boundary schemas. | Strong reusable pattern; remove Alaro ports/Devenv/actions. |
| `src/types.ts` | Schema-inferred and UI coordination types. | Reuse pattern; simplify duplicated slot fields. |
| `src/constants.ts` | Fixed slots/ports/actions, polling, persistence keys. | Mostly needs config-driven replacement. |
| `src/action-groups.ts` | Classify Apps vs Devenv actions for bulk pending state. | Apps-only design may eliminate it. |
| `src/instance-state.ts` | Health, transitions, labels, disabled logic, pending keys. | Reuse after defining generic lifecycle state machine. Contains Alaro copy and Devenv branches. |
| `src/port-entries.ts` | Convert fixed port records to named entries. | Replace fixed records with config arrays. |
| `src/formatting.ts` | Logs, app port labels, process duration, refresh-age label. | Mostly reusable; refresh-age helper is currently dead. |
| `src/panel-layout.ts` | Validate/read/write resizable split. | Reuse with generic storage key. |
| `src/worktree-view-mode.ts` | Persist and apply mapped/all filter. | Reconsider “mapped” semantics; otherwise reusable. |
| `src/lib/utils.ts` | `clsx` + `tailwind-merge` helper. | Reuse, though styles are custom CSS rather than Tailwind utilities. |
| `src/vite-env.d.ts` | Vite client types. | Reuse. |

### Hooks

| File | Responsibility | Reuse/genericity notes |
| --- | --- | --- |
| `hooks/use-instance-queries.ts` | Poll workspace and selected logs; manual combined refresh. | Reuse with 30s default and generic names. |
| `hooks/use-instance-actions.ts` | Mutations, pending maps, global error, invalidation, inspect-on-action. | Reuse pattern; split mutations/commands to reduce one large hook. |
| `hooks/use-now.ts` | One-second clock for durations. | Reuse. |
| `hooks/use-panel-layout.ts` | Hydrate/persist split layout. | Reuse. |
| `hooks/use-worktree-view-mode.ts` | Hydrate/persist table filter. | Reuse if both views survive. |

### Feature components

| File | Responsibility | Reuse/genericity notes |
| --- | --- | --- |
| `components/control-toolbar.tsx` | Brand/path, view toggle, workspace menu, refresh progress. | Core design to reuse; interval becomes 30s. |
| `components/instance-table.tsx` | Headers, skeleton switch, rows, bulk stop menus. | Remove Devenv column/bulk state; keep Apps bulk stop if desired. |
| `components/instance-table-row.tsx` | Derive row health/actions and render all cells. | Core target; remove Devenv and formalize partial behavior. |
| `components/instance-selector.tsx` | Combined start/stop + slot dropdown + hover status. | Highly reusable; enhance options with ports/availability/owner. |
| `components/instance-actions.tsx` | Overflow-only row actions and confirmations. | Reuse menu structure; commands become config/capability-driven. |
| `components/instance-table-skeleton.tsx` | Eight-row loading skeleton. | Update columns and add empty state. |
| `components/health-dot.tsx` | Active/partial/inactive dot. | Reuse. |
| `components/app-status-hover-card.tsx` | Apps configured/running/missing port details. | Reuse with dynamic port definitions. |
| `components/devenv-status-hover-card.tsx` | Devenv port details. | Remove. |
| `components/port-status-hover-card.tsx` | Generic running/not-running port card. | Reuse directly. |
| `components/ports.tsx` | Browser links for API/dashboard, disabled number otherwise. | Generalize URL/protocol/browser-link metadata. |
| `components/instance-panel.tsx` | Details shell, ports/actions/process/log diagnostics. | Valuable optional feature; define scope. |
| `components/instance-panel-actions.tsx` | Direct Apps/Devenv start/stop + maintenance menu. | Remove Devenv; clarify direct Apps controls vs rule 7. |
| `components/instance-panel-ports.tsx` | Apps + Devenv cards. | Reduce to Apps or redesign to use width better. |
| `components/process-list.tsx` | Recent process status/command/message. | Reuse. |
| `components/terminal-log.tsx` | Loading/error/empty log, auto-scroll, copy. | Reuse. |
| `components/workspace-actions-menu.tsx` | New worktree and propagate dialogs. | Reuse only if both features remain in scope. |
| `components/create-worktree-dialog.tsx` | Branch form, next-slot preview, pending/errors. | Genericize folder preview and setup flow. |
| `components/propagate-env-dialog.tsx` | Safe relative file, dry-run/overwrite flow. | Reuse if propagation remains a product feature. |
| `src/styles.css` | Entire visual system, responsive table, panels, menus, dialogs, health, countdown, skeletons. | Reusable baseline; remove Devenv column selectors and brand-tinted toggle. |

### UI primitives

`components/ui/{button,button-group,dialog,dropdown-menu,input,resizable,scroll-area,separator,skeleton,table,toggle-group}.tsx` are thin accessible Radix/React wrappers with shared CSS class names and a `cn` helper. They are generic and reusable. `badge.tsx` supplies variants but is unused by the current feature code. No feature behavior is hidden in these files.

## Recommended generic module seams

To honor “one command per file” without mixing UI transport and OS execution, use three layers:

```text
src/
  commands/
    start-apps.ts
    stop-apps.ts
    set-app-slot.ts
    create-worktree.ts
    delete-worktree.ts
    sync.ts                 # optional capability
    db-setup.ts             # optional capability
    reload-direnv.ts        # optional capability
    propagate-file.ts       # optional capability
    command.ts              # shared contract/result/runner utilities
  workspace/
    discover-worktrees.ts
    load-project-config.ts
    resolve-slot.ts
    inspect-ports.ts
    inspect-processes.ts
  server/
    routes/...
  client/
    queries/...
    mutations/...
```

Each command module should declare its ID, label, availability/capability check, validation, exclusivity rules, execution mode (synchronous or managed long-running), and run implementation. A registry can power both routes and menus. This makes optional repo-specific commands appear only when configured and prevents rebuilding an Alaro-specific action union in a new monolith.

The generic project configuration needs, at minimum:

- repo path and stable project ID;
- worktree discovery/naming policy;
- slot range or explicit slot list;
- per-slot env values and target env file(s);
- named app ports per slot, including required/optional and browser URL metadata;
- start command, cwd, shell, env/direnv policy, readiness timeout;
- stop/process-tree strategy;
- optional setup/sync/db/propagation commands;
- platform support declaration.

## Ambiguities requiring product decisions

1. **Name:** Is this a standalone product, a ChatJS tool, or an internal utility? “Treeboard” is the clearest organized-tree/control-board option, but package/binary naming should follow the distribution model.
2. **Target platforms:** Does “PC” include Windows, or is v1 macOS-only? The Alaro implementation depends on `bash`, POSIX signals/process groups, `lsof`, `tail`, optional `direnv`, and shell scripts.
3. **Repo onboarding/config source:** Is the repo selected once in a launcher, passed on startup, stored in app settings, or represented by a checked-in config file? Can the app manage multiple root repos simultaneously?
4. **Meaning of “apps”:** Is a worktree started by one aggregate command or multiple independently startable apps? Which named ports are required vs optional?
5. **Slot environment format:** What exact file and keys does “sets worktree env slots configs” mean for arbitrary repos? Should the app directly edit `.env`/`.env.local`, execute a repo-defined command, or support adapters/templates?
6. **Slot calculation:** Are slots an integer plus a port offset, or arbitrary named profiles with explicit ports/env? How many are available, and is slot 0 special?
7. **Slot suggestions:** Should occupied slots be hidden, shown disabled with owning worktree, or allow a coordinated swap? Should the menu show every app's port or only primary browser ports?
8. **Partial click behavior:** In partial state should clicking Apps stop all running processes (current row behavior), start/restart to repair missing listeners (backend supports Start), or open a choice?
9. **Listener semantics:** Is a bound port sufficient, or should each app optionally define an HTTP/TCP readiness check? How are Docker processes attributed to a worktree?
10. **Start/stop scope:** Does requested menu-only behavior apply only to table row actions, or should the detail panel also remove its direct Start/Stop button?
11. **Feature scope inherited from Alaro:** Keep or omit All worktrees filter, Stop all apps, create/delete worktree, file propagation/dry-run, Sync, DB setup, direnv reload, per-port links/hover details, process history, terminal logs, and resizable details?
12. **Worktree creation:** Should generic creation be `git worktree add -b`, support an existing branch, and run configurable post-create hooks? How should folder names be chosen?
13. **Persistence/daemon:** Is this still a browser SPA served by a local daemon, a desktop shell, or part of another app? Should managed processes survive/reconnect across controller restarts?
14. **Refresh semantics:** Exactly 30 seconds always, configurable per project, or driven by React Query defaults? Should countdown stop when the tab is hidden/offline and reset after failed polls?
15. **Security boundary:** Loopback binding is helpful, but mutation endpoints have no authentication/origin/CSRF checks. Is localhost-only adequate for commands that edit files and kill processes?
16. **Stable worktree identity:** Use canonical repo path, Git worktree metadata, or persisted UUID? The Alaro `10,000+` extra IDs are discovery-order-sensitive and unsuitable as durable identifiers.

## Risks and opportunities not visible in the screenshot

- The current server rescans every listener and often invokes `lsof` for individual PIDs/ports on each 10-second poll. This is simple but may become costly with many repos/ports; preserve snapshotting and add measurement before optimizing.
- No request body limit exists. Local-only lowers risk, but the generic server should bound JSON bodies.
- Vite dev middleware is used in the always-on server; a distributable app should serve built static assets in production.
- There are no tests in this app package despite complex parsing, ownership, state, and command-safety behavior. The most valuable tests are pure discovery/config/slot/health parsers and integration tests around refusal to kill outside-repo PIDs.
- The UI exposes no “controller disconnected” state separate from a normal query error, no empty workspace onboarding, and no recovery guidance for missing OS dependencies.
- Current mutation errors are flattened to a single banner. Per-row command results or toasts would better preserve context when multiple worktrees are managed.
- Current server process history is ephemeral. If logs/process status are a core feature, persist enough metadata to reconcile managed children after restart.
