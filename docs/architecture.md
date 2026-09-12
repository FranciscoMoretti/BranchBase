# Architecture

BranchBase is one modular application with two interaction clients. CLI-only use does not require the dashboard or Codex. Both clients use the local HTTP daemon, which owns lifecycle operations and operational writes.

```text
client/ (dashboard)    adapters/cli/
          \           /
          adapters/http/
                 |
           application/
       commands + WorkspaceController
                 |
  project/ configuration/ app-group/ activity/ codex/
                 |
  adapters/git/ host/ routing/ persistence/

daemon/ composes the production dependencies and writer lease
```

## Module ownership

| Module | Responsibility |
| --- | --- |
| `application` | Command contracts, use-case ordering, explicit refresh/reconciliation, and the `WorkspaceController` facade. |
| `project` | Discovery, catalog metadata, and shared Project status. The configured worktree contract is a detail of that status, not another source of truth. |
| `configuration` | Checked-in configuration resolution, validation, initialization, and fingerprint approval policy. A selected source and its validity are separate facts. |
| `app-group` | Lifecycle serialization, instance/endpoint assignments, readiness, and canonical status rules. |
| `activity` | Derivation of operational history changes; the catalog persists its bounded history and baselines. |
| `codex` | Optional task integration and bounded activity/context metadata. |
| `adapters` | Git, macOS/process inspection, routing, atomic storage, HTTP, and CLI mechanics. |
| `daemon` | Production composition and the process-lifetime single-writer lease. |

## Rules that matter

- Dependencies must not point from application/domain/infrastructure back to interaction clients or daemon bootstrap. Browser-reachable contracts must not import host runtime code. Architecture tests enforce these constraints.
- `readProjectStatus` and `readConfiguredStatus` are read operations. `refreshProjectStatus` explicitly performs reconciliation and activity recording; the HTTP query uses this application operation. Legacy `inspect` remains a configured-only compatibility facade with refresh semantics.
- Configuration failures do not erase discovered worktrees or retained runs. Runtime and observation failures are reported independently. The legacy configured-only HTTP endpoint remains for compatibility.
- Reconciliation assigns stable identities, but backing ports are allocated only by lifecycle execution. Status collectors do not mint IDs or update persisted state; application refresh operations may reconcile identities and record observations.
- Setup and App-group actions execute only fingerprint-approved repository commands. Stop uses captured run information and fresh ownership evidence; invalid current configuration does not prevent cleanup.
- Command receipts distinguish `accepted` background Setup work from `completed` operations. Inspect Project status for subsequent Setup success or failure; command acceptance is not a claim that Setup succeeded.
- Restart serializes the complete stop/start operation. Shared instances use the same lock keys regardless of the requesting worktree.
- Infrastructure implementations satisfy narrow consumer interfaces. Do not add empty interfaces, inheritance trees, or generic job frameworks merely to resemble a layered diagram.
- Tests should cover public behavior and seam contracts: partial status, atomic lifecycle behavior, stale ownership, persistent identities, approval drift, and client/daemon parity.

## Validation

```sh
bun lint
bun test:types
bun test
bun run build
bun run test:integration
bun run test:pack
```

The optional live Codex compatibility test is skipped unless explicitly enabled. The Portless integration suite is separate from the default tests because it exercises real host routing resources.
