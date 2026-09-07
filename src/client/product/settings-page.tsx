import { useState } from "react";

import type { ProjectOverview } from "../../controller/product-contract";
import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { RepositoryConfigPage } from "../components/repository-config-page";
import { ThemeToggle } from "../components/theme-toggle";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { useCommands } from "../mutations";
import { useCodexIntegration } from "../queries";
import { hrefFor, useProductCommand } from "./data";
import {
  DevelopmentFoldersControls,
  DiscoveryDialog,
} from "./discovery-dialog";
import { CopyButton, ErrorNotice, PageHeading, Status } from "./primitives";

function connectionLabel(error: boolean, loading: boolean): string {
  if (error) {
    return "Discovery unavailable";
  }
  return loading ? "Connecting" : "Task discovery connected";
}

export function SettingsPage({
  data,
  project,
  review,
  section,
  onSectionChange,
}: {
  data: WorkspaceSnapshot;
  project?: ProjectOverview;
  review: () => void;
  section: string;
  onSectionChange: (value: string) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const mutation = useProductCommand();
  const commands = useCommands(data.repoPath);
  const [removing, setRemoving] = useState(false);
  if (editing) {
    return (
      <RepositoryConfigPage
        config={data.projectDefaultConfig}
        configPath={data.projectDefaultConfigPath}
        error={commands.updateRepositoryConfig.error}
        navigationRequest={0}
        onClose={() => setEditing(false)}
        onDirtyChange={(dirty) =>
          window.dispatchEvent(
            new CustomEvent("branchbase:settings-dirty", { detail: dirty })
          )
        }
        onSave={async (config) => {
          await commands.updateRepositoryConfig.mutateAsync({
            config,
            repoPath: data.repoPath,
            revision: data.projectDefaultConfigRevision,
          });
          setEditing(false);
        }}
        pending={commands.updateRepositoryConfig.isPending}
      />
    );
  }
  return (
    <>
      <PageHeading title="Project settings">
        <a className="product-link" href={hrefFor({ view: "machine" })}>
          BranchBase settings
        </a>
      </PageHeading>
      <ErrorNotice error={mutation.error} />
      <div className="product-settings">
        <nav aria-label="Settings sections">
          {["general", "configuration", "command trust", "integrations"].map(
            (value) => (
              <Button
                aria-pressed={section === value}
                key={value}
                onClick={() => onSectionChange(value)}
                variant="ghost"
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </Button>
            )
          )}
        </nav>
        <div className="product-settings-body">
          {section === "general" ? (
            <>
              <form
                className="product-settings-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate({
                    command: "save-project",
                    name: name ?? project?.name ?? data.repoName,
                    repoPath: data.repoPath,
                  });
                }}
              >
                <h2>General</h2>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                    <Input
                      id="project-name"
                      maxLength={100}
                      onChange={(event) => {
                        setName(event.target.value);
                        mutation.reset();
                      }}
                      required
                      value={name ?? project?.name ?? data.repoName}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Repository path</FieldLabel>
                    <div className="product-actions">
                      <code>{data.repoPath}</code>
                      <CopyButton
                        label="Copy repository path"
                        value={data.repoPath}
                      />
                    </div>
                  </Field>
                </FieldGroup>
                <Button
                  disabled={
                    mutation.isPending ||
                    !(name ?? project?.name ?? data.repoName).trim()
                  }
                  type="submit"
                >
                  {mutation.isPending ? "Saving…" : "Save changes"}
                </Button>
                {mutation.isSuccess ? (
                  <p role="status">Project saved.</p>
                ) : null}
              </form>
              <section className="product-settings-panel">
                <h2>Remove project from BranchBase</h2>
                <p className="product-muted">
                  Repository files and worktrees remain on disk. Stop its
                  running groups before removing it.
                </p>
                {removing ? (
                  <div className="product-actions">
                    <Button
                      onClick={() => setRemoving(false)}
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={mutation.isPending}
                      onClick={async () => {
                        try {
                          await mutation.mutateAsync({
                            command: "remove-project",
                            repoPath: data.repoPath,
                          });
                          window.location.assign("/");
                        } catch {
                          /* Display mutation error. */
                        }
                      }}
                      variant="destructive"
                    >
                      Remove project
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setRemoving(true)} variant="outline">
                    Remove project…
                  </Button>
                )}
              </section>
            </>
          ) : null}
          {section === "configuration" ? (
            <section className="product-settings-panel">
              <h2>Project default</h2>
              <p className="product-muted">
                Worktrees inherit this configuration unless they select their
                own.
              </p>
              <code>{data.projectDefaultConfigPath}</code>
              <Status label="Valid" value="running" />
              <div className="product-setting-row">
                <span>Setup command</span>
                <code>{data.projectDefaultConfig.setup.argv.join(" ")}</code>
              </div>
              <div className="product-setting-row">
                <span>App groups</span>
                <span>
                  {Object.entries(data.projectDefaultConfig.appGroups)
                    .map(([id, group]) => group.name ?? id)
                    .join(", ")}
                </span>
              </div>
              <Button onClick={() => setEditing(true)} variant="outline">
                Edit configuration
              </Button>
              <h3>Worktree overrides</h3>
              {data.worktrees.map((worktree) => (
                <div className="product-setting-row" key={worktree.id}>
                  <a
                    className="product-link"
                    href={hrefFor({
                      group: worktree.primaryAppGroup,
                      panel: "configuration",
                      repo: data.repoPath,
                      worktree: worktree.id,
                    })}
                  >
                    {worktree.branch}
                  </a>
                  <span>
                    {worktree.configuration.preference === "checkout"
                      ? "This worktree"
                      : "Project default"}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          {section === "command trust" ? (
            <section className="product-settings-panel">
              <h2>Command trust</h2>
              <Status
                label={
                  data.trusted ? "Project default approved" : "Review required"
                }
                value={data.trusted ? "running" : "partial"}
              />
              <p className="product-muted">
                Approval applies only to reviewed command fingerprints. Worktree
                configurations can require separate approval.
              </p>
              <code className="product-fingerprint">
                {data.trustFingerprint}
              </code>
              <pre className="product-command-preview">
                {data.trustCommands.join("\n")}
              </pre>
              <div className="product-actions">
                <Button onClick={review}>Review commands</Button>
                <Button
                  disabled={mutation.isPending || !data.trusted}
                  onClick={() =>
                    mutation.mutate({
                      command: "revoke-trust",
                      repoPath: data.repoPath,
                    })
                  }
                  variant="outline"
                >
                  Revoke project approvals
                </Button>
              </div>
              <p className="product-muted">
                Stop running groups before revoking their command approvals.
              </p>
            </section>
          ) : null}
          {section === "integrations" ? (
            <IntegrationSettings repoPath={data.repoPath} />
          ) : null}
        </div>
      </div>
    </>
  );
}
export function BranchBaseSettings() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeading
        description="Appearance and project discovery across your workspace."
        title="BranchBase settings"
      />
      <section className="product-settings-panel">
        <h2>Appearance</h2>
        <div className="product-setting-row">
          <p>Choose light, dark, or your system appearance.</p>
          <ThemeToggle />
        </div>
      </section>
      <section className="product-settings-panel" id="development-folders">
        <h2>Development folders</h2>
        <p className="product-muted">
          Choose where BranchBase discovers projects. New repositories are found
          every 30 seconds while the dashboard is active. Removing a folder
          keeps its projects.
        </p>
        <DevelopmentFoldersControls onAdd={() => setAdding(true)} />
      </section>
      <Disclosure className="product-diagnostics" summary="Diagnostics">
        <p className="product-muted">
          Connection details for troubleshooting BranchBase.
        </p>
        <div className="product-setting-row">
          <span>Dashboard address</span>
          <div className="product-actions">
            <code>{window.location.origin}</code>
            <CopyButton
              label="Copy dashboard address"
              value={window.location.origin}
            />
          </div>
        </div>
      </Disclosure>
      {adding ? (
        <DiscoveryDialog
          initialKind="folder"
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

function IntegrationSettings({ repoPath }: { repoPath: string }) {
  const codex = useCodexIntegration(repoPath);
  return (
    <section className="product-settings-panel">
      <h2>Codex</h2>
      <Status
        label={connectionLabel(codex.isError, codex.isLoading)}
        value={codex.isError || codex.isLoading ? "partial" : "running"}
      />
      <p className="product-muted">
        Task discovery matches conversations to their exact worktree paths. Live
        activity requires the optional BranchBase Codex plugin.
      </p>
      <Button
        disabled={codex.isFetching}
        onClick={() => codex.refetch()}
        variant="outline"
      >
        {codex.isFetching ? "Checking connection…" : "Refresh connection"}
      </Button>
      <h3>Enable live activity</h3>
      <p>Install the plugin, restart Codex, and review its hooks.</p>
      <code className="product-command-preview">
        codex plugin marketplace add FranciscoMoretti/BranchBase --ref main
        {"\n"}codex plugin add branchbase@branchbase
      </code>
      <CopyButton
        label="Copy plugin installation commands"
        value="codex plugin marketplace add FranciscoMoretti/BranchBase --ref main\ncodex plugin add branchbase@branchbase"
      />
      <div aria-live="polite" className="product-form-feedback">
        {codex.error ? (
          <p>
            Task discovery is unavailable. Refresh the connection to try again.
            App controls remain available.
          </p>
        ) : null}
      </div>
    </section>
  );
}
