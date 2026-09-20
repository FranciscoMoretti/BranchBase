import { useState } from "react";

import type { ProjectOverview } from "../../project/catalog-contract";
import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { RepositoryConfigPage } from "../components/repository-config-page";
import { ThemeToggle } from "../components/theme-toggle";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { useCommand, useCommands } from "../mutations";
import { useCodexIntegration } from "../queries";
import { FormFeedback } from "./async-state";
import { hrefFor } from "./data";
import {
  DevelopmentFoldersControls,
  DiscoveryDialog,
} from "./discovery-dialog";
import { CopyButton, PageHeading, Status } from "./primitives";

const connectionLabel = (error: boolean, loading: boolean): string => {
  if (error) {
    return "Discovery unavailable";
  }
  return loading ? "Connecting" : "Task discovery connected";
};

const IntegrationSettings = ({ repoPath }: { repoPath: string }) => {
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
      <div
        aria-atomic="true"
        aria-live="polite"
        className="product-form-feedback"
      >
        {codex.error ? (
          <Alert aria-live="polite">
            <AlertDescription>
              Task discovery is unavailable. Refresh the connection to try
              again. App controls remain available.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
};

export const SettingsPage = ({
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
}) => {
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const save = useCommand("save-project");
  const remove = useCommand("remove-project");
  const identityPending = save.isPending || remove.isPending;
  const revoke = useCommand("revoke-trust");
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
      <Tabs
        className="product-settings"
        orientation="vertical"
        value={section}
        onValueChange={onSectionChange}
      >
        <TabsList
          aria-label="Settings sections"
          className="w-full"
          variant="line"
        >
          {["general", "configuration", "command trust", "integrations"].map(
            (value) => (
              <TabsTrigger key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </TabsTrigger>
            )
          )}
        </TabsList>
        <div className="product-settings-body">
          <TabsContent className="product-settings-body" value="general">
            <form
              className="product-settings-panel"
              onSubmit={(event) => {
                event.preventDefault();
                if (identityPending) {
                  return;
                }
                save.mutate({
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
                    disabled={identityPending}
                    id="project-name"
                    maxLength={100}
                    onChange={(event) => {
                      setName(event.target.value);
                      save.reset();
                    }}
                    required
                    value={name ?? project?.name ?? data.repoName}
                  />
                </Field>
                <Field>
                  <FieldTitle>Repository path</FieldTitle>
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
                  identityPending ||
                  !(name ?? project?.name ?? data.repoName).trim()
                }
                type="submit"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
              <FormFeedback error={save.error} title="Could not save project" />
              {save.isSuccess ? (
                <p aria-atomic="true" aria-live="polite">
                  Project saved.
                </p>
              ) : null}
            </form>
            <section className="product-settings-panel">
              <h2>Remove project from BranchBase</h2>
              <p className="product-muted">
                Repository files and worktrees remain on disk. Stop its running
                groups before removing it.
              </p>
              {removing ? (
                <div className="product-actions">
                  <Button
                    disabled={remove.isPending}
                    onClick={() => {
                      setRemoving(false);
                      remove.reset();
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={identityPending}
                    onClick={async () => {
                      try {
                        await remove.mutateAsync({
                          repoPath: data.repoPath,
                        });
                        window.location.assign("/");
                      } catch {
                        /* Display mutation error. */
                      }
                    }}
                    variant="destructive"
                  >
                    {remove.isPending ? "Removing…" : "Remove project"}
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setRemoving(true)} variant="outline">
                  Remove project…
                </Button>
              )}
              <FormFeedback
                error={remove.error}
                title="Could not remove project"
              />
            </section>
          </TabsContent>
          <TabsContent value="configuration">
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
              <Button
                onClick={() => {
                  commands.updateRepositoryConfig.reset();
                  setEditing(true);
                }}
                variant="outline"
              >
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
          </TabsContent>
          <TabsContent value="command trust">
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
                <Button
                  onClick={() => {
                    revoke.reset();
                    review();
                  }}
                >
                  Review commands
                </Button>
                <Button
                  disabled={revoke.isPending || !data.trusted}
                  onClick={() =>
                    revoke.mutate({
                      repoPath: data.repoPath,
                    })
                  }
                  variant="outline"
                >
                  {revoke.isPending ? "Revoking…" : "Revoke project approvals"}
                </Button>
              </div>
              <FormFeedback
                error={revoke.error}
                title="Could not revoke approvals"
              />
              {revoke.isSuccess && !data.trusted ? (
                <p aria-live="polite">Project approvals revoked.</p>
              ) : null}
              <p className="product-muted">
                Stop running groups before revoking their command approvals.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="integrations">
            <IntegrationSettings repoPath={data.repoPath} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
};
export const BranchBaseSettings = () => {
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
};
