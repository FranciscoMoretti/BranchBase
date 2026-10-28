import { useState } from "react";

import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useCommand } from "../mutations";
import { FormFeedback } from "./async-state";
import { countLabel, ErrorNotice, Status } from "./primitives";

type ManagedResource = NonNullable<
  WorkspaceSnapshot["managedResources"]
>[number];
type ResourceOperation = ReturnType<
  typeof useCommand<"operate-managed-resource">
>;
type ResourceBuild = ReturnType<typeof useCommand<"build-managed-resource">>;
const healthStatus = {
  "not-running": { label: "Stopped", value: "stopped" },
  "partially-running": { label: "Needs attention", value: "partial" },
  running: { label: "Running", value: "running" },
};
const instanceState = (
  resource: ManagedResource,
  instance: string,
  operate: ResourceOperation,
  build: ResourceBuild
) => {
  const observation = resource.observations[instance];
  const health = observation?.health;
  const running = health !== undefined && health !== "not-running";
  const inUse = Boolean(observation?.consumers || observation?.manual);
  const busy = operate.isPending || build.isPending;
  const operating =
    operate.isPending &&
    operate.variables?.resource === resource.id &&
    operate.variables?.instance === instance;
  const building =
    build.isPending &&
    build.variables?.resource === resource.id &&
    build.variables?.instance === instance;
  const actionLabel = running ? "Stop" : "Start";
  return {
    actionLabel,
    building,
    busy,
    health,
    inUse,
    observation,
    operating,
    running,
  };
};
const InstanceCard = ({
  resource,
  instance,
  repoPath,
  operate,
  build,
}: {
  resource: ManagedResource;
  instance: string;
  repoPath: string;
  operate: ResourceOperation;
  build: ResourceBuild;
}) => {
  const {
    actionLabel,
    building,
    busy,
    health,
    inUse,
    observation,
    operating,
    running,
  } = instanceState(resource, instance, operate, build);
  return (
    <section
      className="product-resource-instance"
      aria-label={`${resource.name} instance ${instance}`}
      key={instance}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Instance {instance}</strong>
        <Status
          {...(health
            ? healthStatus[health]
            : { label: "Status unavailable", value: "partial" })}
        />
      </div>
      <p className="product-muted">
        {observation
          ? countLabel(observation.consumers, "active consumer")
          : "Consumer count unavailable"}
        {observation?.manual ? " · manual command in use" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={running ? "outline" : "default"}
          disabled={!resource.approved || busy || !health || (running && inUse)}
          onClick={() =>
            operate.mutate({
              action: running ? "stop" : "start",
              instance,
              repoPath,
              resource: resource.id,
            })
          }
        >
          {operating ? "Working…" : actionLabel}
        </Button>
        {running ? (
          <Button
            variant="outline"
            disabled={!resource.approved || busy || inUse}
            onClick={() =>
              operate.mutate({
                action: "restart",
                instance,
                repoPath,
                resource: resource.id,
              })
            }
          >
            Restart
          </Button>
        ) : null}
        {resource.canBuild ? (
          <Button
            variant="ghost"
            disabled={!resource.approved || busy}
            onClick={() =>
              build.mutate({
                instance,
                repoPath,
                resource: resource.id,
              })
            }
          >
            {building ? "Building…" : "Build"}
          </Button>
        ) : null}
      </div>
      {inUse ? (
        <p className="product-muted">
          Stop active consumers and finish manual commands before stopping or
          restarting this instance.
        </p>
      ) : null}
      {resource.approved ? null : (
        <p className="product-muted">
          Review and approve this definition to enable commands.
        </p>
      )}
    </section>
  );
};
const OperationFeedback = ({
  operate,
  build,
}: {
  operate: ResourceOperation;
  build: ResourceBuild;
}) => (
  <>
    {operate.isSuccess ? (
      <output>
        {operate.variables.resource} / {operate.variables.instance}:{" "}
        {operate.variables.action} completed. Status refreshes automatically.
      </output>
    ) : null}
    {build.isSuccess ? (
      <output>
        Build completed for {build.variables.resource} /{" "}
        {build.variables.instance}.
      </output>
    ) : null}
    <ErrorNotice error={build.error ?? operate.error} />
  </>
);

export const ManagedResourceCatalog = ({
  data,
}: {
  data: WorkspaceSnapshot;
}) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const register = useCommand("register-managed-resource", data.repoPath);
  const approve = useCommand("approve-managed-resource", data.repoPath);
  const build = useCommand("build-managed-resource", data.repoPath);
  const operate = useCommand("operate-managed-resource", data.repoPath);
  const resources = (data.managedResources ?? []).toSorted(
    (a, b) =>
      Number(Boolean(data.projectDefaultConfig.managedResources?.[b.id])) -
      Number(Boolean(data.projectDefaultConfig.managedResources?.[a.id]))
  );
  return (
    <section
      className="product-settings-panel mb-4"
      aria-label="Managed resource definitions"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Managed resource definitions</h2>
          <p className="product-muted">
            Named instances can serve applications across projects. Commands run
            from the resource’s owner directory.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            register.reset();
            approve.reset();
            setFile("");
            setOpen(true);
          }}
        >
          Register managed resource
        </Button>
      </div>
      {resources.map((resource) => (
        <div className="product-resource-definition" key={resource.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3>{resource.name}</h3>
            <span className="product-muted">
              {resource.approved ? "Commands approved" : "Review required"}
            </span>
          </div>
          {data.projectDefaultConfig.managedResources?.[resource.id] ? (
            <p className="product-muted">
              Declared in this project’s .branchbase.json
            </p>
          ) : null}
          <p className="product-muted">
            Resource ID: <code>{resource.id}</code>
          </p>
          {data.projectDefaultConfig.managedResources?.[resource.id] ? null : (
            <p className="product-muted">
              Registered on this machine · not declared by this project
            </p>
          )}
          {resource.error ? (
            <p role="alert" className="text-destructive">
              {resource.error}
            </p>
          ) : null}
          <div className="product-resource-instances">
            {resource.instances.map((instance) => (
              <InstanceCard
                key={instance}
                resource={resource}
                instance={instance}
                repoPath={data.repoPath}
                operate={operate}
                build={build}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                register.reset();
                approve.reset();
                setFile(resource.path);
                register.mutate({
                  definitionPath: resource.path,
                  repoPath: data.repoPath,
                });
                setOpen(true);
              }}
            >
              Review definition
            </Button>
            <span className="product-muted break-all">{resource.path}</span>
          </div>
        </div>
      ))}
      {resources.length === 0 ? (
        <p className="product-muted">
          No managed definitions registered. Declare a file in .branchbase.json
          or register one here.
        </p>
      ) : null}
      <OperationFeedback operate={operate} build={build} />
      {open ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!approve.isPending && !register.isPending) {
              setOpen(value);
            }
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Managed resource definition</DialogTitle>
              <DialogDescription>
                Register a definition file containing its owner directory,
                lifecycle commands, tracked source files, and named instances.
                Registration starts nothing.
              </DialogDescription>
            </DialogHeader>
            <Label htmlFor="managed-definition">Definition file</Label>
            <Input
              id="managed-definition"
              disabled={approve.isPending || register.isPending}
              value={file}
              onChange={(event) => {
                setFile(event.target.value);
                register.reset();
                approve.reset();
              }}
              placeholder="/path/to/resource.json"
            />
            <Button
              disabled={!file || register.isPending || approve.isPending}
              onClick={() =>
                register.mutate({
                  definitionPath: file,
                  repoPath: data.repoPath,
                })
              }
            >
              {register.isPending ? "Reading definition…" : "Read and register"}
            </Button>
            {register.data && !register.isPending && !register.isError ? (
              <>
                <p className="product-muted break-all">
                  Execution directory: {register.data.directory}
                </p>
                <pre className="max-h-80 overflow-auto rounded border p-3 text-xs">
                  {JSON.stringify(register.data.definition, null, 2)}
                </pre>
                <p className="product-muted">
                  Review these commands and their source files before approving.
                  Script or recipe changes require a new approval.
                </p>
                <Button
                  disabled={approve.isPending || register.isPending}
                  onClick={() => {
                    if (!register.data) {
                      return;
                    }
                    approve.mutate(
                      {
                        repoPath: data.repoPath,
                        resource: register.data.id,
                        revision: register.data.revision,
                      },
                      { onSuccess: () => setOpen(false) }
                    );
                  }}
                >
                  {approve.isPending ? "Approving…" : "Approve this revision"}
                </Button>
              </>
            ) : null}
            <FormFeedback error={register.error ?? approve.error} />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
};
