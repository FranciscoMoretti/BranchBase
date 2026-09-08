import { Popover } from "@base-ui/react/popover";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRightIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import type {
  DetectedService,
  Observation,
} from "../../controller/discovery-contract";
import type { ProjectOverview } from "../../controller/product-contract";
import { RepositoryInitializeDialog } from "../components/repository-initialize-dialog";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import { Input } from "../components/ui/input";
import { CodexTasksSection } from "../components/worktree-details";
import { useCodexIntegration } from "../queries";
import { ActivityPage } from "./activity-page";
import { FormFeedback } from "./async-state";
import { useProductCommand } from "./data";
import type { ProductLocation } from "./data";
import {
  Blank,
  CopyButton,
  countLabel,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";

const WINDOWS_PATH_SEPARATOR = /[\\/]/;

export const ServiceLink = ({ service }: { service: DetectedService }) => (
  <span className="product-actions product-service-link" title={service.cwd}>
    <code>:{service.port}</code>
    {service.url ? (
      <a
        aria-label={`Open port ${service.port}`}
        className="product-link"
        href={service.url}
        rel="noreferrer"
        target="_blank"
      >
        Open
        <ArrowUpRightIcon />
      </a>
    ) : (
      <span className="product-muted">TCP</span>
    )}
    <CopyButton
      label={`Copy address for port ${service.port}`}
      value={service.url ?? service.address}
    />
  </span>
);
export const ServiceOverflow = ({
  services,
}: {
  services: DetectedService[];
}) => {
  if (services.length === 0) {
    return null;
  }
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${services.length} more services`}
        render={<Button size="sm" variant="outline" />}
      >
        +{services.length}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50" sideOffset={8}>
          <Popover.Popup className="product-services-popup">
            <Popover.Title className="sr-only">
              More detected services
            </Popover.Title>
            {services.map((service) => (
              <ServiceLink
                key={`${service.pid}:${service.port}`}
                service={service}
              />
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};
const ServiceRow = ({ service }: { service: DetectedService }) => (
  <div className="product-detected-service">
    <div>
      <strong>{service.command}</strong>
      <p className="product-muted">
        PID {service.pid}
        {service.startedAt
          ? ` · Started ${new Date(service.startedAt).toLocaleString()}`
          : ""}
      </p>
    </div>
    <ResourceUsage usage={service.resources} />
    <ServiceLink service={service} />
  </div>
);
export const DetectedServicesSection = ({ data }: { data?: Observation }) => {
  if (!data) {
    return null;
  }
  const worktrees = data.worktrees.filter((worktree) =>
    worktree.services.some((service) => !service.managed)
  );
  if (!(worktrees.length || data.warning)) {
    return null;
  }
  return (
    <section className="product-detected-section">
      <h2>Detected services</h2>
      <p className="product-muted">
        Associated by working directory. These processes were started outside
        BranchBase; lifecycle and logs are managed by their launcher.
      </p>
      {data.warning ? (
        <p aria-atomic="true" aria-live="polite" className="product-warning">
          {data.warning}
        </p>
      ) : null}
      {worktrees.map((worktree) => (
        <div key={worktree.id}>
          <h3>{worktree.branch}</h3>
          {worktree.services
            .filter((service) => !service.managed)
            .map((service) => (
              <ServiceRow
                key={`${service.pid}:${service.port}`}
                service={service}
              />
            ))}
        </div>
      ))}
    </section>
  );
};
const ObservedSettings = ({
  data,
  project,
  configure,
}: {
  data: Observation;
  project?: ProjectOverview;
  configure: () => void;
}) => {
  const [name, setName] = useState<string | null>(null);
  const resolvedName =
    name ??
    project?.name ??
    data.repoPath.split(WINDOWS_PATH_SEPARATOR).at(-1) ??
    "Project";
  const command = useProductCommand();
  return (
    <>
      <PageHeading
        description="Project identity and app configuration"
        title="Settings"
      />
      <section className="product-settings-panel">
        <h2>General</h2>
        <label htmlFor="observed-project-name">Project name</label>
        <Input
          id="observed-project-name"
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            command.reset();
          }}
          value={resolvedName}
        />
        <div className="product-actions product-path">
          <code>{data.repoPath}</code>
          <CopyButton label="Copy repository path" value={data.repoPath} />
        </div>
        <Button
          disabled={command.isPending || !resolvedName.trim()}
          onClick={() =>
            command.mutate({
              command: "save-project",
              name: resolvedName,
              repoPath: data.repoPath,
            })
          }
        >
          {command.isPending ? "Saving…" : "Save changes"}
        </Button>
        <span aria-atomic="true" aria-live="polite">
          {command.isSuccess ? " Project saved." : ""}
        </span>
        <FormFeedback error={command.error} />
      </section>
      <section className="product-settings-panel">
        <h2>App groups</h2>
        <p className="product-muted">
          Add .branchbase.json to define apps, shared infrastructure, and
          commands for each worktree. Commands need your approval before
          BranchBase runs them.
        </p>
        <Button onClick={configure} variant="outline">
          Configure app groups
        </Button>
      </section>
    </>
  );
};
export const ObservedProjectPage = ({
  data,
  project,
  location,
}: {
  data: Observation;
  project?: ProjectOverview;
  location: ProductLocation;
}) => {
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState(false);
  const [configure, setConfigure] = useState(false);
  const client = useQueryClient();
  const codex = useCodexIntegration(data.repoPath);
  const visible = data.worktrees
    .filter(
      (worktree) =>
        `${worktree.branch} ${worktree.path}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!running || worktree.services.length)
    )
    .toSorted(
      (a, b) => Number(b.services.length > 0) - Number(a.services.length > 0)
    );
  const services = data.worktrees.flatMap((worktree) => worktree.services);
  return (
    <>
      {location.view === "activity" ? (
        <ActivityPage repoPath={data.repoPath} />
      ) : null}
      {location.view === "settings" ? (
        <ObservedSettings
          configure={() => setConfigure(true)}
          data={data}
          project={project}
        />
      ) : null}
      {location.view === "infrastructure" ? (
        <>
          <PageHeading
            description="Shared services across worktrees"
            title="Infrastructure"
          />
          <Blank
            description="Detected listeners appear in Environments. Configure app groups to describe shared databases and other infrastructure, and give them managed controls."
            title="Shared infrastructure is not configured"
          >
            <Button onClick={() => setConfigure(true)} variant="outline">
              Configure app groups
            </Button>
          </Blank>
        </>
      ) : null}
      {location.view === "workspace" ? (
        <>
          <PageHeading
            description={`${countLabel(data.worktrees.length, "worktree")} · ${countLabel(services.length, "service")} detected`}
            title="Environments"
          >
            <ResourceUsage usage={data.resources} />
            <Button onClick={() => setConfigure(true)} variant="outline">
              Configure app groups
            </Button>
          </PageHeading>
          <div className="product-observation-note">
            <Status label="Observing" value="stopped" />
            <p>
              See what is running across your worktrees. Add app groups when you
              want Start, Stop, and logs here.
            </p>
          </div>
          <div className="product-filterbar">
            <Search
              onChange={setSearch}
              placeholder="Search worktrees…"
              value={search}
            />
            <fieldset
              aria-label="Filter worktrees"
              className="product-filter-options"
            >
              <Button
                aria-pressed={!running}
                onClick={() => setRunning(false)}
                variant="ghost"
              >
                All {data.worktrees.length}
              </Button>
              <Button
                aria-pressed={running}
                onClick={() => setRunning(true)}
                variant="ghost"
              >
                With services{" "}
                {
                  data.worktrees.filter((worktree) => worktree.services.length)
                    .length
                }
              </Button>
            </fieldset>
          </div>
          {data.warning ? (
            <div
              aria-atomic="true"
              aria-live="polite"
              className="product-observation-warning"
            >
              {data.warning}
            </div>
          ) : null}
          <div className="product-observed-worktrees">
            {visible.map((worktree) => (
              <article className="product-observed-worktree" key={worktree.id}>
                <div className="product-observed-worktree-heading">
                  <GitBranchIcon />
                  <div className="product-observed-identity">
                    <h2>
                      {worktree.branch}
                      {worktree.isMain ? (
                        <span className="product-chip">Main worktree</span>
                      ) : null}
                    </h2>
                    <div className="product-path">
                      <span title={worktree.path}>{worktree.path}</span>
                      <CopyButton
                        label={`Copy path for ${worktree.branch}`}
                        value={worktree.path}
                      />
                    </div>
                  </div>
                  <div className="product-observed-links">
                    {worktree.services.slice(0, 2).map((service) => (
                      <ServiceLink
                        key={`${service.pid}:${service.port}`}
                        service={service}
                      />
                    ))}
                    <ServiceOverflow services={worktree.services.slice(2)} />
                    {worktree.services.length === 0 ? (
                      <span className="product-muted">
                        No listeners detected
                      </span>
                    ) : null}
                  </div>
                </div>
                <Disclosure
                  className="product-observed-details"
                  summary={`${countLabel(worktree.services.length, "service")} · ${codex.isPending ? "Discovering tasks…" : `${countLabel(codex.data?.worktrees[worktree.id]?.tasks.length ?? 0, "task")}`} · Details`}
                >
                  {worktree.services.map((service) => (
                    <ServiceRow
                      key={`${service.pid}:${service.port}`}
                      service={service}
                    />
                  ))}
                  <CodexTasksSection
                    discoveryUnavailable={codex.isError}
                    loading={codex.isPending}
                    tasks={codex.data?.worktrees[worktree.id]?.tasks ?? []}
                    worktreePath={worktree.path}
                  />
                </Disclosure>
              </article>
            ))}
          </div>
          {visible.length === 0 ? (
            <Blank
              description="Try another search or choose All."
              title="No matching worktrees"
            />
          ) : null}
          <p className="product-observation-footnote">
            Services are associated by working directory. Open is available
            after an HTTP response. Processes and logs remain with the tool that
            started them.
          </p>
        </>
      ) : null}
      {configure ? (
        <RepositoryInitializeDialog
          onClose={() => setConfigure(false)}
          onCreated={async () => {
            setConfigure(false);
            await Promise.all([
              client.invalidateQueries({ queryKey: ["observation"] }),
              client.invalidateQueries({ queryKey: ["projects"] }),
              client.invalidateQueries({ queryKey: ["workspace"] }),
            ]);
          }}
          repoPath={data.repoPath}
        />
      ) : null}
    </>
  );
};
