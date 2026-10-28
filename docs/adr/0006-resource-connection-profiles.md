# ADR 0006: Resolve resource connections through worktree profiles

The cross-project ownership and compatibility restrictions below are superseded by [ADR 0007](0007-independent-managed-resources.md).

Profiles in `.branchbase.json` select existing, project-shared, or worktree-dedicated infrastructure instances. They extend the App-group instance model from ADR 0002 rather than introduce a separately running Environment: this keeps command ownership, readiness, and cleanup in the existing lifecycle while making reuse and isolation explicit.

Branch rules select policy, not instance identity. Worktrees matched by the same rule still receive distinct instances when the policy is `worktree`. User overrides and the machine-wide existing-resource catalog are local relationships; profile definitions and branch rules remain repository configuration. Existing resources expose endpoints only and are never started, stopped, or deleted by BranchBase. This initial account-level scope is the local machine, with no cloud account required.

Start resolves dependencies in order and captures their instance identities and endpoint bindings. Shared managed resources run from the primary checkout so they can outlive a linked worktree. Changing a running worktree's profile requires an explicit restart; Stop refuses to shut down resources with retained consumers and may stop unused dependencies according to the captured idle policy. Discovery and previews never launch commands. Instance IDs survive Stop and Restart; repository commands remain responsible for container naming and persistent volumes, using the stable instance token. Data deletion is outside the profile lifecycle.

Connection and dependency policies are part of the approved configuration contract. Different contracts cannot silently reuse the same managed resource. Arbitrary Compose files are not rewritten: repositories bind their published ports and project names explicitly. This costs a small amount of configuration but avoids guessing service topology or deleting containers and volumes owned by another tool.
