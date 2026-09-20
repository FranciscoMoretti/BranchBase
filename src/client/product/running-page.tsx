import { appGroupIsRunning } from "../../project/worktree-status-contract";
import { QueryContent } from "./async-state";
import { hrefFor, useProjects } from "./data";
import type { ProductLocation } from "./data";
import { DetectedServicesSection } from "./observed-project-page";
import { Blank, PageHeading } from "./primitives";
import { WorkspacePage } from "./workspace-page";

export const RunningPage = ({
  navigate,
}: {
  navigate: (location: Partial<ProductLocation>) => void;
}) => {
  const projects = useProjects();
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
              {project.workspace ? (
                <WorkspacePage
                  data={project.workspace}
                  location={{
                    group: "",
                    panel: "logs",
                    repo: project.path,
                    section: "general",
                    view: "running",
                    worktree: "",
                  }}
                  navigate={navigate}
                  project={project}
                  refresh={projects.refetch}
                />
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
