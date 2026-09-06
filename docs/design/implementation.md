# Approved design implementation — 2026-09-06

This record captures the initial dashboard implementation and its visual checkpoints.
The subsequent [project discovery implementation](project-discovery.md) adds
unconfigured projects and associated listeners. Global preferences are now named
BranchBase settings, with a Settings gear, Appearance, Development folders, and
collapsed Diagnostics; the earlier Machine settings and Local labels are superseded.

BranchBase now opens on Projects, with saved repositories, names, runtime summaries,
worktree-qualified pinned Apps, search, and recovery links. Project navigation leads
to Environments, Infrastructure, Activity, and Settings. The previous worktree table,
permanent details pane, toolbar, and repository workspace components were removed.

Environments retains the accepted A model: two compact App groups, two App links per
group, explicit overflow menus, and expansion for all groups. Start/Stop/Restart stay
scoped to an App group. Ready HTTP Apps open only when their route is valid; TCP
connections can be copied. Group details provide endpoints, managed logs, activity,
configuration/instance selection, worktree tasks, and referenced dependencies.
Returning to Environments retains expansion, filters, and scroll within the project.

Infrastructure uses an explicit `category` in `.branchbase.json`. Selectable instances
are deduplicated and selecting worktrees are visible. Shared Stop/Restart explains
its scope before execution. Named instances without a selecting worktree remain
visible. Retained runs can be inspected and stopped. Settings exposes one section
at a time, preserves the configuration editor and draft protections, and reviews the
exact command fingerprint. Removing a project preserves its files and is blocked
while owned processes, pending lifecycle operations, or retained runs remain.

## Runtime data

- Saved projects, names, pins, and the latest 2,000 operational events persist beside
  runtime state in `product.json`. History survives project removal.
- Activity records commands and observed changes in readiness, routing, configuration,
  trust, and worktree discovery. Observation timestamps are detection times, not a
  promise of exact process-exit times. Polling while the UI is open refreshes at five
  seconds; this is not a continuously sampling background event collector.
- CPU and memory are observations of verified managed root processes and descendants.
  RSS is summed across processes; it is not unique physical-memory accounting. CPU
  can exceed 100% across cores. Missing measurements are omitted. Detached external
  runtimes do not receive fabricated resource figures.
- Selecting an infrastructure instance does not prove active network traffic. Unknown
  operation initiators are not labeled as a human or agent.
- Logs remain the managed App-group stream. Per-App log attribution and arbitrary
  machine-wide process discovery from the concepts remain exploratory, as recorded
  in the approved design notes. Foreign listeners at configured endpoints continue
  to be reported by existing ownership diagnostics.

## Visual comparison

The concept images and saved browser renders were opened together during the final
review. Concepts are 1536×1024, except Projects at 1568×1003. Browser evidence uses
an actual 1280×720 desktop viewport; full-page captures include content below the fold
and exclude the scrollbar. Temporary viewport overrides did not change the in-app
browser's reported dimensions, so this is not a claim of native-size pixel matching
or mobile browser verification. Responsive rules are present; mobile remains untested.

| Surface | Reference and browser evidence | Review result |
| --- | --- | --- |
| Environments | [A1](screens/a1-quick-controls.png), [render](verification/environments.jpg) | Retains white Geist shell, restrained borders, blue active tab, status dots, and compact group controls. Two-line collapsed rows accommodate long monorepo names. Resources were moved beside the heading controls to remove an unnecessary row. Agent state stays at worktree level, correcting the concept's per-group Agent column. |
| App overflow | [A2](screens/a2-app-overflow.png), [render](verification/app-overflow.jpg) | Persistent click/keyboard menu keeps the row collapsed and includes app name, readiness, Open, and group details. Visual QA caught render-element children hiding readiness/Open; corrected and rechecked with four ready Apps. |
| Group details | [A3](screens/a3-group-details.png), [render](verification/group-details.jpg) | Preserves context strip, endpoint table, scoped lifecycle controls, subtabs, and bounded log viewport. Real sample has four Apps rather than two; endpoints wrap. Measured resources replace illustrative figures. No invented author or per-App log filter. |
| Projects | [concept](screens/projects-proposed.png), [render](verification/projects.jpg) | Uses project rows, canonical paths, precise runtime summaries, worktree-qualified pins, and one Add project action. Actual sample has one project. Removed vague Healthy copy and redundant bottom Add action as agreed. |
| Infrastructure | [concept](screens/infrastructure-proposed.png), [render](verification/infrastructure.jpg) | Instance rows, group context, direct lifecycle/log controls, and expandable selecting worktrees are implemented. Explicit unused-instance section prevents named alternatives disappearing. No fabricated external Postgres observation. |
| Activity | [concept](screens/activity-proposed.png), [render](verification/activity.jpg) | Compact timestamped event rows, search, event/time/worktree filters, and diagnostic links. Filters now show human-readable labels. Screenshot demonstrates combined Runtime and text filtering. Historical warnings do not masquerade as current unresolved issues. |
| Settings | [concept](screens/settings-proposed.png), [render](verification/settings.jpg) | Left section navigation, restrained forms, copyable path, scoped Save, and separate removal area. Shows one section at a time per approved refinement. Fixed project-name initialization for direct links before final verification. |

## Functional verification

The flow under test was Projects → existing repository → discovered worktrees →
review configured commands → start an App group → open a ready App → inspect runtime,
then operate shared instances and project settings.

Browser checks used the Codex in-app browser through CUA. No alternate browser
automation was used. Page identity, nonblank rendering, absence of framework overlays,
console health after clean reload, visible action outcomes, and screenshot evidence
were checked. Expected command-rejection responses were examined separately from
interface errors. The settings-name issue found during iteration was fixed and the
screen retested after reload.

The integration sample is `/Users/fran/Code/chat-js-branchbase-qa`, a local clone with
three worktrees. The existing `chat-js-dev-control` checkout was left untouched.
The sample starts the real ChatJS Next.js site plus explicitly labeled API/Admin/Health
fixtures; it does not claim to test the full ChatJS backend. Its local QA script and
configuration are committed only in that clone. Exact friendly hostnames were allowed
in the sample's Next.js development configuration for asset loading.

Verified interactions:

- Add project; discover three existing worktrees; review exact commands and grant
  fingerprint-scoped trust through the UI.
- Start Product in two worktrees concurrently: all eight backing ports distinct,
  all four Apps per group ready, friendly URLs working. The real ChatJS site rendered
  its expected heading with no browser errors.
- Restart the BranchBase dev server and re-adopt both surviving managed runtimes.
- Open ready Apps and overflow menus without expanding a worktree; pin an App and
  find its branch-qualified link in Projects; open pin management.
- Expand a worktree, enter group details, return, and retain expansion.
- Start shared infrastructure, inspect its three selecting worktrees, and confirm
  shared Stop with all affected worktrees named.
- Create and select a named instance, return to Default, and find the unused instance
  on Infrastructure.
- Combine event-type and text filters and inspect the resulting activity subset.
- Rename the project, inspect configuration and integration status, reject invalid
  JSON, guard dirty navigation, keep editing, and explicitly discard the draft.
- Attempt project removal while apps are running: the server rejects it and the
  dialog displays the ownership/retained-run explanation.
- Stop all sample groups after QA. The dashboard and saved sample remain available.

Required checks passed: `bun lint`, `bun test:types`, `bun test` (190 passed,
1 environment-dependent Codex discovery test skipped), and `bun run build`.
`bun run test:integration` additionally passed all six routing/lifecycle tests:
concurrency/trust, worktree isolation, proxy-crash recovery, configured Stop commands,
foreign-route protection, and route-conflict preservation. The production build
retains Vite's nonfatal warning for its main chunk exceeding 500 kB.
