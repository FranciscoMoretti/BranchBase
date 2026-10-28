# Resource profiles

Resource profiles decide which infrastructure a worktree uses. Open **Infrastructure → Enable resource profiles** to add Shared development and Isolated development to the project configuration. Stop existing app groups first, then review and approve the updated commands before starting.

| Connection policy | Instance identity | Created or started |
| --- | --- | --- |
| `project` | One instance per project and configuration contract | On Start, if needed |
| `worktree` | One instance per worktree and configuration contract | On Start, if needed |
| `managed` | Named instance with an authoritative owner, reusable across projects | On Start, after owner command approval |
| `existing` | Named resource registered on this machine, reusable across projects | Never; managed by its existing owner |

Viewing a project or previewing a profile starts nothing. Start brings dependencies up first, waits for their readiness, and then starts the application or worker. Stop stops the application; a dependency's `idle` policy controls whether it keeps running or stops after its last consumer. The default is `keep-running`. Stop and Restart retain instance identity. BranchBase adds no data-deletion step; repository Stop commands still determine data retention.

Select a profile from the worktree's **Resource profile** panel. The preview shows which connections will be reused and which need a new instance. A stopped worktree applies its selection without launching services. A running worktree requires **Apply and restart**. Already-running consumers keep their captured connections until that explicit restart.

Profile precedence is an explicit local worktree selection, the first matching branch rule, then the project default. `*` is the only wildcard and matches any branch-name characters. A rule for `feature/*` selecting Isolated development creates separate instances for each worktree; it does not share an instance among feature branches. **Use branch / project default** clears the local override.

For named managed instances, independent owner commands, and connection outputs, see the [managed resources guide](managed-resources.md).

## Docker Compose example

Keep these settings in `.branchbase.json`. Edit them through the existing project configuration editor or in the file itself. Infrastructure groups omitted from a profile's connections use the `project` policy.

```json
{
  "version": 1,
  "setup": { "argv": ["bun", "install"] },
  "profiles": {
    "default": "shared",
    "definitions": {
      "shared": {
        "name": "Shared development",
        "connections": {
          "services": { "policy": "project", "idle": "keep-running" }
        }
      },
      "isolated": {
        "name": "Isolated development",
        "connections": {
          "services": { "policy": "worktree", "idle": "stop-when-unused" }
        }
      }
    },
    "rules": [{ "branch": "experiment/*", "profile": "isolated" }]
  },
  "appGroups": {
    "web": {
      "start": { "argv": ["bun", "run", "dev"] },
      "stop": "process",
      "dependsOn": ["services"],
      "env": {
        "PORT": "{apps.web.port}",
        "DATABASE_URL": "postgresql://dev:dev@{appGroups.services.apps.database.host}:{appGroups.services.apps.database.port}/dev"
      },
      "apps": { "web": { "protocol": "http" } }
    },
    "services": {
      "category": "infrastructure",
      "start": {
        "argv": [
          "docker",
          "compose",
          "-p",
          "branchbase-{instance.id}",
          "up",
          "-d"
        ]
      },
      "stop": {
        "argv": ["docker", "compose", "-p", "branchbase-{instance.id}", "stop"]
      },
      "env": { "DATABASE_PORT": "{apps.database.port}" },
      "apps": { "database": { "protocol": "tcp" } }
    }
  }
}
```

The matching `compose.yaml` publishes the assigned host port and uses a Compose-scoped volume:

```yaml
services:
  database:
    image: postgres:17
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: dev
    ports:
      - "127.0.0.1:${DATABASE_PORT}:5432"
    volumes:
      - database:/var/lib/postgresql/data
volumes:
  database:
```

`{instance.id}` is stable across restarts and distinct for isolated resource instances. Use it for Compose project names, avoiding fixed `container_name`, global volume names, or fixed host ports that defeat isolation. Shared resources launch from the primary checkout; dedicated resources launch from their worktree. Both checkouts must contain the required command files. BranchBase never copies production data or runs migrations implicitly. Configure initialization explicitly in the repository's commands.

`{worktree.id}` identifies the worktree owning a run, useful for application-specific queue prefixes. It is not the namespace for a shared resource; use `{instance.id}` there.

With profiles configured, application groups depend on all infrastructure groups by default. `dependsOn` overrides that default; use `[]` for an independent app. Dependencies are validated for missing groups and cycles. Shared project resources cannot depend on worktree-specific groups, which would give other worktrees an ambiguous connection. Workers can use `"apps": {}` with `"stop": "process"`; their health reports process liveness, while endpoint groups report network readiness.

## Existing services

Use **Infrastructure → Resources on this machine → Connect existing resource** to register a name, resource ID, and TCP endpoints. Endpoint names must match the infrastructure group's app IDs. Then reference that ID in a profile:

```json
{
  "name": "Existing services",
  "connections": {
    "services": { "policy": "existing", "resource": "local-postgres" }
  }
}
```

The existing group's commands remain in the project configuration for managed profiles, but are never executed for an existing connection. BranchBase checks the registered endpoints before launching consumers and injects their host/port bindings. Existing services show **Externally managed** and have no lifecycle controls. Resource IDs cannot be overwritten; register a new ID and explicitly switch the profile to change endpoints. Registration is local to this machine and contains no credentials; secrets remain in the repository's environment setup.

This release does not import or rewrite Compose files, provision cloud accounts, clone database contents, or delete resource data. A profile switch retains the old instance; unused instances with `keep-running` remain visible for explicit cleanup. Changes to the configuration contract require command approval and can produce new managed instance identities, preserving old runs as cleanup targets.
