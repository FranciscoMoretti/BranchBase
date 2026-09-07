# BranchBase origin specification (historical)

Status: Historical source material; see the current `README.md`, `CONTEXT.md`, and architectural decisions under `docs/adr/` for the active product model.

Product name: **BranchBase**

Implementation workspace: `codex/branchbase`

Last updated: 2026-07-12

## Summary

Build a local control app that takes a Git repository path, discovers every worktree belonging to that repository, assigns each worktree a unique worktree-environment slot, shows the configured app ports and their live status, and starts or stops the worktree's app stack without requiring terminal use.

The UI keeps the successful structure of Alaro Dev Control: a compact worktree table, combined Apps action/slot selector, port links, an overflow action menu, manual and automatic refresh, and an optional diagnostics panel. It removes Alaro's separate Devenv system and replaces every fixed repo, port, slot, command, package-manager, and folder-name assumption with the existing `.worktree-env.json` model plus a small generic control extension.

The primary source audit is [Alaro `devenv_control` source audit](./alaro-devenv-control-audit.md). It covers all 60 source files at commit [`44b5468`](https://github.com/alaro-ai/alaro/tree/44b546877cb06ddaa15ab1d5e6ab13438e5e7ddf/app/devenv_control). The current ChatJS slot runtime originated in [ChatJS PR #208](https://github.com/FranciscoMoretti/chat-js/pull/208).

## Naming

The finalized product name is **BranchBase**. A grove is a place containing a manageable collection of trees; the `work` prefix makes the Git worktree model explicit and gives the app a distinct command, package, storage, and search identity. The implementation lives in `apps/branchbase` as `@chatjs/branchbase`.

## Goals

1. Onboard a local Git repository from a path, loading an existing `.worktree-env.json` or offering a preview-and-confirm starter configuration.
2. Discover the main checkout and all linked worktrees through Git, regardless of their folder names or locations.
3. Read, display, assign, and change the slot stored in each worktree's `.env.worktree.local`.
4. Prevent two worktrees from being assigned the same slot unless the user completes an explicit coordinated reassignment.
5. Resolve ports and URLs from the same runtime used by repository development commands.
6. Derive Apps health from configured listening ports: `not-running`, `partially-running`, or `running`.
7. Start and stop a worktree's aggregate app stack from its Apps button.
8. Keep every mutating backend operation in one command module per file and expose it through TanStack React Query mutations.
9. Preserve safe process ownership, managed logs, useful diagnostics, and guarded worktree deletion.
10. Remain generic enough for another repo to adopt by adding configuration rather than changing app code.

## Non-goals for v1

- Managing shared infrastructure or a second Devenv slot bank.
- Deploying, building production artifacts, or managing remote environments.
- Independently starting each app in a worktree. The Apps button controls one configured aggregate stack.
- Treating a reserved but non-listening port as a failed app.
- Full container ownership attribution.
- Coordinated slot swapping in one transaction; occupied slots are visible but unavailable in v1.
- A general-purpose arbitrary shell-command dashboard.

## Proposed product defaults pending confirmation

These are the recommended answers to the open questions at the end of this spec:

- Ship v1 as a loopback-only local web app and Bun/Node daemon, preserving the old UI delivery model. A packaged desktop shell can follow without changing the controller interface.
- Support macOS first. Keep platform-specific port/process inspection behind an internal adapter so Linux and Windows can be added deliberately.
- Run one repo-agnostic daemon and scope each browser tab to one repository through a shareable `?repo=<absolute-path>` URL. Separate tabs can control separate repositories, with recently used paths persisted by the client.
- Treat `.worktree-env.json` as the canonical checked-in project configuration and `.env.worktree.local` as the ignored per-worktree assignment file.
- Start one aggregate command per worktree. For ChatJS, add a root command that starts the intended web apps through their wrapped leaf commands.
- In partial state, clicking Apps stops the running stack. This matches the visible action and is safer than assuming rerunning an aggregate command will repair only missing listeners.
- Retain details, process history, logs, per-port status, create/delete worktree, and Stop all. Defer file propagation, DB setup, and direnv-specific actions unless configured later.
- Treat Electron's offset as reserved/non-probed in v1. Electron continues opening the Chat URL and does not count toward Apps health.

## Product model

### Workspace

A workspace is one Git worktree topology rooted at a user-selected repository. The canonical identity is the repository's Git common directory, not the selected folder name. The selected path may be the main checkout or any linked worktree.

The workspace exposes:

- `id`: stable hash of the canonical Git common directory;
- `selectedPath`: the path supplied by the user;
- `mainWorktreePath`;
- `configPath`: canonical `.worktree-env.json` path;
- `worktrees`: discovered worktree records;
- `availableSlots`: computed from the configured port range and currently assigned slots;
- `capabilities`: commands available for this repo and this platform.

### Worktree

A worktree uses its canonical real path as stable identity. It contains:

- path, display name, Git branch or detached commit, main/non-main flag;
- configuration state: `assigned`, `unassigned`, `invalid`, or `conflicting`;
- selected slot and resolved app endpoints;
- Apps health and each probed endpoint's listener/ownership state;
- managed process state and recent command summaries;
- allowed commands and reasons disabled commands are unavailable.

Do not reuse Alaro's discovery-order `10,000+` IDs. Paths appear in URLs only through an opaque server-issued ID derived from the canonical path.

### Slot

A slot is a non-negative integer resolved by the existing formula:

```text
rangeStart = range.base + slot * range.stride
appPort    = rangeStart + app.offset
```

The highest valid slot is calculated from `65535`, the base, stride, and greatest configured offset. The UI shows only the current slot, occupied slots, and a bounded set of the nearest available suggestions rather than rendering thousands of theoretical values.

Each selector option shows:

```text
Slot 6     Chat 3060 · Site 3062
Slot 7     Chat 3070 · Site 3072
Slot 8     In use by chat-js-8
```

Available suggestions come first. Occupied slots remain visible, disabled, and labelled with their owning worktree. This makes a rejected selection predictable before the mutation.

### App endpoint and health

An app entry can participate in environment resolution, health aggregation, browser linking, or any combination of those roles.

- `probe: tcp` means listener presence contributes to Apps health.
- `required: true` means the endpoint must listen for the aggregate state to be `running`.
- `open: true` means its resolved URL can be opened from the Ports column.
- `probe: none` reserves an offset and exports environment without affecting health.

Aggregate health:

| State | Rule | Primary Apps click |
| --- | --- | --- |
| Not running | No required probed endpoints are owned/listening | Start |
| Partially running | At least one but not all required probed endpoints are owned/listening | Stop |
| Running | All required probed endpoints are owned/listening | Stop |

The Apps button text remains `Apps {slot}`. The dot, accessible status label, and hover/focus card communicate the state. Do not render the old `mapped` subtitle.

Listener presence is liveness, not full application readiness. HTTP readiness checks can be added later without changing the three-state UI.

## Configuration contract

### Existing contract to preserve

Keep the current fields and resolver semantics in `.worktree-env.json`:

- `slot.env` and `slot.default`;
- `range.base` and `range.stride`;
- shared `url` template;
- dynamic `apps` with offset and exports;
- template expansion for slot, port, URL, and cross-app endpoints;
- validation for unique offsets, range bounds, env names, and final ports `1024..65535`.

Before the controller is implemented, complete the runtime improvement from the handoff:

1. Find `.worktree-env.json` by walking upward from the current directory.
2. Load adjacent `.env.worktree.local` inside the runtime.
3. Wrap each leaf app's development command with a short reusable CLI.
4. Make root commands reach those same wrapped leaf commands through Turbo.

This makes direct app starts and controller starts use the same port behavior.

### Proposed optional control metadata

Extend the schema backward-compatibly. The resolver may ignore control-only metadata while the controller consumes it.

```jsonc
{
  "$schema": "./.agents/skills/worktree-ports/assets/worktree-env.schema.json",
  "slot": {
    "env": "CHATJS_DEV_SLOT",
    "default": 0,
    "file": ".env.worktree.local",
  },
  "range": { "base": 3000, "stride": 10 },
  "url": "http://localhost:{port}",
  "apps": {
    "chat": {
      "offset": 0,
      "exports": { "APP_URL": "{url}", "PORT": "{port}" },
      "control": { "probe": "tcp", "required": true, "open": true },
    },
    "electron": {
      "offset": 1,
      "exports": { "ELECTRON_APP_URL": "{apps.chat.url}" },
      "control": { "probe": "none", "required": false, "open": false },
    },
    "site": {
      "offset": 2,
      "exports": { "PORT": "{port}" },
      "control": { "probe": "tcp", "required": true, "open": true },
    },
  },
  "control": {
    "start": { "argv": ["bun", "run", "dev:all"] },
    "postCreate": { "argv": ["bun", "install"] },
  },
}
```

Rules:

- Commands are argv arrays, never interpolated shell strings.
- Paths and `cwd` are resolved relative to the worktree root and cannot escape it.
- `start` is required for lifecycle control; `postCreate` is optional.
- Stop is controller-owned: terminate the managed process group, then inspect configured ports and stop only listener processes proven to belong to the worktree.
- Optional repo-specific actions should be added only when a real cross-repo use case exists.

### Slot file behavior

The controller reads the filename from `slot.file`, defaulting to `.env.worktree.local` for backward compatibility. It parses normal `KEY=value` lines, preserves unrelated keys and comments, and atomically replaces only the configured `slot.env` assignment.

Slot mutations are rejected when:

- any required app endpoint is listening;
- a managed command is running for that worktree;
- the target slot is assigned to another discovered worktree;
- the computed range would produce an invalid port;
- the file is a symlink or resolves outside the worktree.

An unassigned worktree is one without an explicit slot value, even though the command-line resolver may fall back to `slot.default`. The UI must expose this difference to prevent multiple missing files silently sharing slot 0.

## User experience

### Onboarding and empty states

On first launch, show a repository path form with a recent-path list. Editing, browsing, or selecting a recent path changes only the form draft; validation runs only when the user clicks **Open repository**. Validation explains whether the path is missing, not a Git worktree, or has invalid configuration. A missing `.worktree-env.json` opens a setup state that previews a conservative detected configuration and writes it only after explicit confirmation. Successful selection opens the workspace table, persists the recent path, and updates the tab URL.

Starting the daemon from a repository opens and prints its repository-scoped URL on macOS. An explicit `--repo` argument overrides the invocation directory. The daemon itself does not own one global active-repository setting; every workspace query and command carries the tab's repository context.

If worktrees are discovered without explicit assignments, show a non-blocking callout:

> 3 worktrees need unique app slots. Assign recommended slots.

The bulk assignment preview lists every file and value before writing. New worktrees created through the app receive the next available slot automatically.

### Toolbar

Left:

- product name;
- active repository name and canonical main-worktree path;
- an inline repository selector containing recent repositories and a separated **Open another repository…** command.

Right:

- New worktree;
- Refresh button.

Refresh behavior:

- workspace query uses `refetchInterval: 30_000`;
- focus and network reconnection may refetch sooner;
- manual click refetches workspace and the open detail log query;
- a background overlay shrinks from right to left over the actual configured interval;
- the animation restarts from `dataUpdatedAt` after a successful result;
- while fetching, the icon spins and the button is disabled;
- a failed refetch shows an error and retries according to Query defaults without falsely reporting a new successful update time.

### Main table

Columns:

1. Repository — display name and absolute path.
2. Branch — branch name or detached short SHA.
3. Apps — combined lifecycle button and slot selector.
4. Ports — dynamic primary URLs/ports from config; listening browser endpoints are links.
5. Actions — overflow menu only.

The Repository header contains a compact segmented **Numbered / All** filter. The numbered view always keeps the canonical main worktree first. The Apps header menu sits beside its label and scopes Setup all, Start all, Restart running, and Stop all to the visible rows.

All interactive primitives are routed through the local shadcn component layer: Button, Input, Checkbox, Dialog, Dropdown Menu, Select, Toggle Group, and Resizable. Feature components do not render native interactive controls or import Radix primitives directly. App-slot choices use shadcn Select with horizontal rows: app slot and availability on the left, configured app ports on the right, and a selected-state indicator.

Row behavior:

- clicking or pressing Enter/Space opens details;
- hover/focus on Apps shows running and not-running endpoint lists;
- pending actions show an operation-specific spinner and label;
- row mutations do not make unrelated rows appear pending;
- invalid/conflicting worktrees remain visible with recovery guidance.

The Actions menu contains only capabilities that are currently valid:

- View details/logs;
- Restart apps when the worktree is running;
- Open folder;
- Open terminal at worktree (optional platform capability);
- Delete worktree for non-main worktrees;
- future configured actions.

Start/Stop never appears in this menu. The table and details panel render the same shared worktree actions menu, with one capability model and the same ordered item set in both locations.

### Details panel

Retain the resizable, persisted full-height right panel because it makes command execution trustworthy without returning to a terminal. The application toolbar, errors, table, and any future footer belong to the left main panel so the inspector spans the complete application content height. Use the resize rail as the visible divider rather than wrapping the panel in a second card. It contains:

- worktree identity and branch;
- assigned slot and all resolved endpoints;
- per-endpoint running/not-running status;
- recent managed commands and durations;
- a lifecycle row between configured apps and the terminal, with Start/Stop plus an overflow menu containing Restart and valid destructive actions;
- terminal output with auto-scroll, Copy, Clear, retry, and automatic reconnect;
- listening/openable endpoints as links, matching the table.

The managed terminal is bounded rather than filling the entire inspector. Raw transport errors such as `Failed to fetch` are never presented as terminal output; the panel shows a recoverable reconnect state instead.

### Worktree actions

Retain:

- Create worktree;
- Delete worktree;
- Stop all apps;
- Restart one running worktree or all running worktrees visible in the current table filter;
- details/process/log views.

Defer from v1:

- propagate arbitrary files to all worktrees;
- DB setup;
- direnv reload;
- generic Sync command.

Create worktree flow:

1. Enter a branch name and choose new vs existing branch.
2. Preview target folder and recommended slot.
3. Execute `git worktree add` using argv, never shell interpolation.
4. Atomically write the slot file.
5. Run the optional `postCreate` command and stream its logs.
6. Keep the worktree visible with a recoverable setup-failed state if the hook fails.

Delete worktree is allowed only when the target is a discovered non-main worktree, no managed command is active, no configured endpoint is listening, and Git accepts removal without force. The confirmation names the exact path. v1 does not expose force deletion.

## Runtime and module design

### Deep controller module

Put Git, filesystem, configuration, port inspection, process tracking, and command rules behind one small interface:

```ts
interface WorkspaceController {
  inspect(repoPath: string): Promise<WorkspaceSnapshot>;
  execute(input: CommandInput): Promise<CommandReceipt>;
  logs(worktreeId: string): Promise<LogSnapshot>;
}
```

The interface returns results; HTTP routes and React Query are adapters at its seam. Tests exercise the same interface as production callers. Platform-specific listener/process inspection is an internal seam with a macOS adapter and test adapter.

### Proposed package layout

```text
apps/branchbase/
  scripts/
    daemon.ts
  src/
    commands/
      command.ts
      create-worktree.ts
      delete-worktree.ts
      set-slot.ts
      start-apps.ts
      stop-all-apps.ts
      stop-apps.ts
    controller/
      workspace-controller.ts
      workspace-snapshot.ts
    git/
      discover-worktrees.ts
    runtime/
      app-health.ts
      config.ts
      ports.ts
      process-supervisor.ts
      slot-file.ts
    server/
      routes.ts
      schemas.ts
      server.ts
    client/
      api/
      components/
      mutations/
      queries/
      app.tsx
      main.tsx
      styles.css
```

Every file in `commands/` owns one operation's validation, availability, exclusivity, and execution. Shared spawning and logging live in `command.ts`; command files do not build shell strings. A registry maps command IDs to modules for transport, but menus are driven by server-returned capabilities rather than a duplicated client action union.

### Query and mutation model

Queries:

- `workspace(repoPath)` — 30-second polling, focus/reconnect refetch;
- `logs(worktreeId)` — enabled only while details are open, 2.5-second polling;
- optional `controllerHealth()` for a distinct disconnected state.

Mutations map one-to-one to command modules:

- `startApps`;
- `stopApps`;
- `stopAllApps`;
- `setSlot`;
- `createWorktree`;
- `deleteWorktree`.

On success, invalidate the workspace and affected log query. Use React Query's mutation state rather than a parallel hand-maintained pending-key set where possible. Server-returned command receipts supply process ID, status, timestamps, message, and affected worktree.

## Process, port, and safety behavior

### Start

- Reject unassigned, conflicting, or invalid worktrees.
- Refuse duplicate starts if a tracked process group is live or all required ports already listen.
- Spawn the configured argv with the worktree as `cwd` and the resolved app environment.
- Create a detached process group on macOS and persist enough metadata to reconnect after controller restart.
- Stream stdout/stderr to a per-worktree bounded/rotated log.
- Consider start successful as a command receipt immediately; health changes only when ports are observed.
- If required ports do not appear within a configurable timeout, report a failed-start diagnostic without assuming the process has exited.

### Inspect

- Snapshot listeners once per workspace poll.
- Attribute a listener to a worktree using tracked process ancestry first and process cwd second.
- If the configured port is occupied by another process/worktree, expose `conflict` rather than claiming the app is running.
- Reserved/non-probed apps never affect aggregate health.

### Stop

- Signal the tracked process group with `SIGTERM`.
- Wait for a bounded grace period.
- Reinspect configured ports.
- Signal only remaining PIDs whose ownership can be proven to the worktree.
- Report skipped PIDs and reasons; never kill an unowned port occupant.
- Escalation to `SIGKILL` requires a separate explicit confirmation and is not part of normal Stop.

### Local server security

- Bind only to loopback.
- Require a random per-install bearer/session token for mutation requests.
- Validate `Origin` and JSON content type.
- Set a small request-body limit.
- Validate every request and response with Zod.
- Do not expose arbitrary shell execution.
- Resolve all worktree paths against the selected Git topology before filesystem or process actions.
- Serve built static assets outside development instead of embedding Vite middleware in the production daemon.

## Error and recovery states

The UI distinguishes:

- controller disconnected;
- invalid repository/config;
- unassigned slot;
- duplicate slot assignment;
- port occupied by another owner;
- start command running but ports not ready;
- partially running;
- command failed with logs;
- required platform dependency missing;
- worktree setup hook failed;
- deletion refused by Git.

Use contextual row/panel errors or toasts rather than one global last-error banner. Preserve the last successful workspace snapshot during background refetch failures.

## Testing and verification strategy

Tests protect stable behavior and safety boundaries, not visual implementation details.

### Required automated tests

1. **Resolver/config tests** — existing offset, export, template, and port-range invariants; new control metadata validation; reserved/non-probed endpoints.
2. **Slot-file tests** — preserve unrelated lines/comments, replace only the configured env key, atomic writes, invalid/symlink paths, missing explicit assignments.
3. **Worktree discovery tests** — arbitrary paths/names, detached heads, selected secondary worktree, prunable entries, stable identity.
4. **Health tests** — zero/some/all required listeners, optional/reserved endpoints, foreign-owner port conflict.
5. **Command interface tests** — availability and refusal rules for start, stop, set slot, create, and delete.
6. **Process safety integration test** — Stop terminates a managed/repo-owned test listener and refuses a foreign listener on the same configured port.
7. **API schema tests** — command and snapshot results round-trip through Zod.
8. **One focused UI interaction test** — Apps main button dispatches the state-appropriate mutation while the chevron changes slots; partial state dispatches Stop.

### Manual verification

- Onboard the main ChatJS checkout from a path.
- Discover arbitrarily named linked worktrees outside the sibling naming pattern.
- Assign unique slots and verify `.env.worktree.local` diffs.
- Start two worktrees and observe non-colliding Chat/Site ports.
- Confirm Not running → Partially running → Running transitions by controlling one listener.
- Verify Electron reservation does not affect health.
- Click live port URLs.
- Confirm 30-second refresh overlay and manual refresh.
- Restart the controller and reconcile managed process state/logs.
- Attempt occupied-slot selection, stopping a foreign process, deleting main, deleting dirty worktree, and path traversal; all must be refused safely.

Run repository `bun lint`, `bun test:types`, focused controller tests, and the existing worktree-runtime tests before handoff. Do not use a production build merely as a type check.

## Delivery plan

### Phase 0 — Complete the shared worktree runtime seam

- Implement upward config discovery and adjacent slot-file loading.
- Add the short leaf-command wrapper.
- Wrap Chat and Site leaf dev commands; simplify root Turbo commands.
- Resolve Electron as a reservation/non-listening profile.
- Preserve and extend focused resolver/invocation tests.

Exit condition: root and direct leaf starts resolve the same slot and ports.

### Phase 1 — Controller domain and config

- Add optional control/probe metadata to config types and schema.
- Implement Git topology discovery, stable worktree identity, slot-file editing, slot suggestions, dynamic health, and controller snapshots.
- Implement the deep `WorkspaceController` interface with test adapters.

Exit condition: tests can inspect a fixture workspace and safely assign slots without HTTP or UI.

### Phase 2 — Commands and local server

- Add one command file per operation.
- Add managed process groups, logging, restart reconciliation, listener ownership, and guarded stop.
- Expose validated loopback routes and static frontend delivery.
- Add mutation token/origin/body-size protections.

Exit condition: API-level manual calls can assign, start, observe, stop, create, and delete safely.

### Phase 3 — React Query UI

- Port/genericize Alaro UI primitives and styling.
- Build onboarding, toolbar, 30-second refresh countdown, table, Apps selector, slot suggestions, port links, capability menu, empty/error states, and accessible row interactions.
- Add resizable diagnostics, process list, and logs.

Exit condition: all core workflows work without a terminal after the controller is running.

### Phase 4 — Operational polish

- Add Stop all, recent repositories, setup recovery, log rotation, controller restart recovery, and platform dependency diagnostics.
- Measure polling cost before optimizing listener inspection.

Exit condition: the controller can remain running throughout normal multi-worktree development.

### Phase 5 — Distribution decision

- Keep daemon/web launch scripts, or wrap the stable controller interface in Electron/Tauri/native packaging.
- Add OS startup integration only after the form-factor decision.

## Acceptance criteria

- A user can enter a valid repo path and see all Git worktrees, including nonstandard folder names.
- Every explicit worktree slot is visible; missing and duplicate assignments are called out.
- Changing a slot writes only the configured slot key and cannot choose an occupied slot.
- Ports and URLs are computed from `.worktree-env.json`, never hard-coded in the app.
- Apps shows exactly Not running, Partially running, or Running from required listener state.
- Clicking the Apps primary button starts when stopped and stops when partial/running.
- The selector displays available slots with port previews and occupied slots with owners.
- There is no Devenv column, model, route, command, or status.
- All other row actions are in the overflow menu.
- Workspace state auto-refreshes every 30 seconds and the button overlay accurately counts down right-to-left; click refresh works immediately.
- Start/stop and every mutation use React Query and one backend command module per operation.
- Stop never terminates a process whose ownership cannot be proven to the target worktree.
- Electron's reserved offset does not prevent Running status.
- Managed logs and command failures are inspectable without a terminal.
- Main-worktree deletion, dirty-worktree deletion, occupied slots, invalid paths, and unsafe requests are rejected.

## Product decisions

Please answer these in priority order:

1. **Name:** **BranchBase**.
2. **Form factor:** Is a local web app + persistent daemon correct for v1, or must v1 be a packaged desktop app that launches by clicking an icon?
3. **Platform:** Can v1 be macOS-only, or is Windows support required immediately?
4. **Repository scope:** One active repo with recents, or multiple repos visible and running in the same dashboard?
5. **Apps scope:** Should the aggregate Apps command start Chat + Site only, with Electron excluded/non-probed, or must Electron also be launched by the Apps button?
6. **Partial state:** Confirm that clicking Apps while partially running should Stop. If not, should it restart/repair instead?
7. **Slot assignment:** Should existing unassigned worktrees be changed only after a bulk preview/confirmation, or should onboarding assign them automatically?
8. **Inherited features:** Confirm v1 retains create/delete worktree, Stop all, details, processes, and logs, while deferring propagation, Sync, DB setup, and direnv actions.
