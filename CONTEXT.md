# BranchBase

BranchBase coordinates development worktrees and the app groups they expose.

## Language

**Project**: A locally tracked Git repository together with the worktrees BranchBase discovers from it.

**Project status**: The complete live projection of a Project, its worktrees, configuration availability, Effective configuration, App group status, and observed resource use. It is computed from current observations and is never persisted as intent. _Avoid_: Workspace snapshot, Project health

**Primary worktree**: The first worktree reported by Git for a Project. Its checked-in configuration is the Project default. _Avoid_: Base repository, Non-worktree

**Project default configuration**: The `.branchbase.json` loaded from a Project's Primary worktree and inherited by worktrees unless they explicitly select their own configuration. _Avoid_: Base configuration

**Worktree configuration preference**: The user-local choice for a worktree to inherit the Project default configuration or read `.branchbase.json` from that worktree.

**Effective configuration**: The valid configuration BranchBase uses to inspect and operate one worktree. If a preferred worktree configuration is missing or invalid, the Project default is effective, the checkout preference remains selected, and the fallback remains visible.

**Configuration contract**: The command and app-group topology fingerprint of an Effective configuration. Selectable app-group instances may be shared only by worktrees with the same Configuration contract, preventing one worktree from operating a shared run with incompatible commands or apps.

**Setup**: A finite repository command that prepares a worktree for development. It is separate from the app group's lifecycle.

**App group**: The named collection of apps that share one Start, Stop, and Restart lifecycle. Its stable identity is independent of its display name. _Avoid_: Runtime

**App**: An observable endpoint in an app group. An HTTP app has a stable Friendly URL backed by a worktree-specific Backing endpoint.

**Friendly URL**: The stable local HTTP address assigned to an app, independent of the backing port selected for its worktree. Every hostname has the shape `<app>.<worktree>.<repository>.localhost`, using stable, locally unique route labels rather than mutable display names. BranchBase owns the assignment and provides the route through Portless. _Avoid_: Public URL, Portless URL

**Backing endpoint**: The host and dynamically assigned port where an app process listens and to which its Friendly URL routes. BranchBase allocates all Backing endpoints for an app group before Start; they may change on every Start. _Avoid_: Slot URL, Real URL

**Endpoint identity**: The opaque, locally persisted identity of a repository, worktree, app group, or app. Display names and route labels do not identify an endpoint; app-group and app logical IDs associate checked-in definitions with their local identities.

**Repository environment**: The complete, explicit set of environment variables BranchBase constructs before launching an app group. App bindings may expose a Backing port, direct URL, or Friendly URL. BranchBase does not inject a generic `PORT` or `PORTLESS_URL` unless the repository explicitly binds one.

**Start**: The app-group lifecycle action that verifies Portless, allocates every Backing endpoint, constructs the Repository environment, launches the trusted repository command, verifies app readiness, activates exact routes, and verifies them before exposing links.

**Process**: The foreground process launched by Start and owned by BranchBase for one worktree and app group.

**Stop**: The app-group lifecycle action that deactivates and verifies routes before stopping the app group with either BranchBase-owned process termination or its trusted repository Stop command, then releases Backing endpoints. A failed route deactivation does not prevent stopping, but its Backing port remains quarantined until the route is confirmed inactive.

**Restart**: The lifecycle action that completes Stop and then performs Start for the same worktree and app group.

**Lifecycle operation**: A transient Start, Stop, Restart, or Setup action. An active operation may temporarily describe an app group as starting or stopping, but it is not persisted as runtime status.

**App group status**: A live projection of Lifecycle operation, Process, Readiness, and Route state. Running, Partial, and Stopped are observations rather than persisted intent. _Avoid_: Desired state

**Readiness**: An app's observed ability to accept traffic at its Backing endpoint. The default check is an owned TCP listener; an app may instead configure an HTTP path and accepted status codes. Readiness is distinct from Process and route state.

**Route state**: The observed state of one app's Friendly URL: `inactive`, `activating`, `active`, `deactivating`, `conflict`, or `unavailable`. A link is exposed only when both Readiness is `ready` and Route state is `active` for the expected Backing endpoint.

**Codex task**: A saved Codex conversation whose captured working directory associates it with a Git worktree.

**Task association**: The relationship between a worktree and every Codex task whose canonical captured working directory exactly matches that worktree path.

**Task inventory**: The ordered collection of every non-archived, non-ephemeral, top-level Codex task associated with a worktree. Subagents are represented through Live task activity rather than as separate inventory entries.

**Live task activity**: Short-lived Codex lifecycle state inferred from trusted hook events for one Codex task. It is one of Working, Waiting for approval, Ready, or Unknown and is distinct from persisted task metadata.

**Working**: Live task activity indicating that Codex has an observed turn in progress, including reasoning, tool use, and subagent work.

**Waiting for approval**: Live task activity indicating that the observed Codex turn is paused on a permission request.

**Ready**: Live task activity indicating that no Codex turn is currently observed in progress. It does not assert that earlier work succeeded.

**Unknown**: Live task activity indicating that BranchBase has no sufficiently fresh lifecycle observation for the Codex task.

**Codex-enabled worktree**: A worktree whose own root contains a valid `.branchbase.json`, allowing the BranchBase Codex plugin to report Live task activity and provide BranchBase context. _Avoid_: Managed worktree

**BranchBase context**: A concise, model-visible snapshot of BranchBase-owned preview endpoints, app-group status, readiness, route state, and process ownership for a Codex-enabled worktree.
