import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { useCodexIntegration } from "../queries";
import { QueryContent } from "./async-state";
import { hrefFor, useProjects } from "./data";
import type { ProductLocation } from "./data";
import { EnvironmentList } from "./environment-list";
import { DetectedServicesSection } from "./observed-project-page";
import { Blank, PageHeading } from "./primitives";
import { runtimeCounts } from "./runtime-counts";
import { useWorktreeControls } from "./use-worktree-controls";

const RunningWorktrees = ({
  data,
  navigate,
}: {
  data: WorkspaceSnapshot;
  navigate: (location: Partial<ProductLocation>) => void;
}) => {
  const codex = useCodexIntegration(data.repoPath);
  const { actions, controls, onDelete, feedback } = useWorktreeControls({
    data,
    onInspect: (worktree, group, panel = "logs") =>
      navigate({
        group: group.id,
        panel,
        repo: data.repoPath,
        view: "workspace",
        worktree: worktree.id,
      }),
  });
  return (
    <>
      {feedback}
      <EnvironmentList
        worktrees={data.worktrees}
        runningOnly
        controls={controls}
        commandActions={actions.commandActions}
        onDelete={onDelete}
        codex={codex.data}
        codexError={codex.isError}
      />
    </>
  );
};

export const RunningPage = ({
  navigate,
}: {
  navigate: (location: Partial<ProductLocation>) => void;
}) => {
  const projects = useProjects();
  const counts = runtimeCounts(projects.data ?? []);
  const active = (projects.data ?? []).filter(
    (project) =>
      project.error ||
      project.observation?.warning ||
      project.workspace?.worktrees.some((worktree) =>
        worktree.appGroups.some(appGroupIsRunning)
      ) ||
      project.observation?.worktrees.some((worktree) =>
        worktree.services.some((service) => !service.managed)
      )
  );
  return (
    <>
      <PageHeading
        title="Running"
        description="Active app groups and detected services across your repositories."
      />
      <QueryContent label="Running services" query={projects}>
        <dl className="product-overview-summary product-runtime-summary">
          <div>
            <dt>Managed app groups</dt>
            <dd>{counts.managedGroups}</dd>
            <p className="product-muted">
              Start, stop, and inspect logs in BranchBase.
            </p>
          </div>
          <div>
            <dt>Detected services</dt>
            <dd>{counts.detectedServices}</dd>
            <p className="product-muted">
              Started elsewhere; controlled by their launcher.
            </p>
          </div>
        </dl>
        <div className="product-running-projects">
          {active.map((project) => (
            <section key={project.path}>
              <a
                className="product-running-project-link"
                href={hrefFor({ repo: project.path })}
              >
                {project.name}
              </a>
              {project.error ? (
                <p className="product-warning">{project.error}</p>
              ) : null}
              {project.workspace?.worktrees.some((worktree) =>
                worktree.appGroups.some(appGroupIsRunning)
              ) ? (
                <section aria-label={`Managed app groups in ${project.name}`}>
                  <h2 className="product-section-title">Managed app groups</h2>
                  <RunningWorktrees
                    data={project.workspace}
                    navigate={navigate}
                  />
                </section>
              ) : null}
              <DetectedServicesSection
                data={project.observation ?? undefined}
              />
            </section>
          ))}
        </div>
        {active.length === 0 ? (
          <Blank
            title="Nothing is running"
            description="Open a repository and start an app group to see it here."
          >
            <a className="product-link" href="/?">
              Browse repositories
            </a>
          </Blank>
        ) : null}
      </QueryContent>
    </>
  );
};
