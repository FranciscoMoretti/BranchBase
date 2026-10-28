import { useState } from "react";

import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { useCommand } from "../mutations";
import { FormFeedback } from "./async-state";

export const ResourceCatalog = ({ data }: { data: WorkspaceSnapshot }) => {
  const register = useCommand("register-resource", data.repoPath);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [endpoints, setEndpoints] = useState([
    { host: "127.0.0.1", key: "first", name: "database", port: "5432" },
  ]);
  const save = async () => {
    try {
      await register.mutateAsync({
        repoPath: data.repoPath,
        resource: {
          apps: Object.fromEntries(
            endpoints.map((endpoint) => [
              endpoint.name,
              {
                host: endpoint.host,
                port: Number(endpoint.port),
                protocol: "tcp" as const,
              },
            ])
          ),
          id,
          name,
        },
      });
      setOpen(false);
    } catch {
      /* Keep entered values visible. */
    }
  };
  return (
    <section
      className="product-settings-panel mb-4"
      aria-label="Externally managed resources"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Externally managed resources</h2>
          <p className="product-muted">
            Connect existing services for reuse across projects. Their lifecycle
            and data stay under their current owner.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Connect existing resource
        </Button>
      </div>
      {(data.existingResources ?? []).map((resource) => (
        <div className="my-3 flex flex-wrap gap-2" key={resource.id}>
          <strong>{resource.name}</strong>
          <span className="product-muted">
            {resource.id} ·{" "}
            {Object.values(resource.apps)
              .map((app) => `${app.host}:${app.port}`)
              .join(", ")}
          </span>
        </div>
      ))}
      {data.existingResources?.length ? null : (
        <p className="product-muted">No external resources connected.</p>
      )}

      {open ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!register.isPending) {
              setOpen(value);
            }
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain">
            <DialogHeader>
              <DialogTitle>Connect existing resource</DialogTitle>
              <DialogDescription>
                Register the endpoints of an existing database, cache, or
                service. Reference its resource ID in a profile’s connection
                policy.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="resource-name">Name</FieldLabel>
                  <Input
                    id="resource-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
                  <Input
                    id="resource-id"
                    value={id}
                    onChange={(event) => setId(event.target.value)}
                    pattern="(?:[a-zA-Z0-9_]|-)+"
                    placeholder="local-postgres"
                    required
                  />
                </Field>
                {endpoints.map((endpoint) => (
                  <FieldGroup key={endpoint.key}>
                    <Field>
                      <FieldLabel htmlFor={`endpoint-${endpoint.key}`}>
                        TCP endpoint name
                      </FieldLabel>
                      <Input
                        id={`endpoint-${endpoint.key}`}
                        value={endpoint.name}
                        onChange={(event) =>
                          setEndpoints((current) =>
                            current.map((item) =>
                              item.key === endpoint.key
                                ? { ...item, name: event.target.value }
                                : item
                            )
                          )
                        }
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`host-${endpoint.key}`}>
                        Host
                      </FieldLabel>
                      <Input
                        id={`host-${endpoint.key}`}
                        value={endpoint.host}
                        onChange={(event) =>
                          setEndpoints((current) =>
                            current.map((item) =>
                              item.key === endpoint.key
                                ? { ...item, host: event.target.value }
                                : item
                            )
                          )
                        }
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`port-${endpoint.key}`}>
                        Port
                      </FieldLabel>
                      <Input
                        id={`port-${endpoint.key}`}
                        type="number"
                        min={1}
                        max={65_535}
                        value={endpoint.port}
                        onChange={(event) =>
                          setEndpoints((current) =>
                            current.map((item) =>
                              item.key === endpoint.key
                                ? { ...item, port: event.target.value }
                                : item
                            )
                          )
                        }
                        required
                      />
                    </Field>
                  </FieldGroup>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setEndpoints((current) => [
                      ...current,
                      {
                        host: "127.0.0.1",
                        key: crypto.randomUUID(),
                        name: "",
                        port: "",
                      },
                    ])
                  }
                >
                  Add endpoint
                </Button>
              </FieldGroup>
              <FormFeedback error={register.error} />
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={register.isPending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    register.isPending ||
                    new Set(endpoints.map((endpoint) => endpoint.name)).size !==
                      endpoints.length
                  }
                >
                  {register.isPending ? "Connecting…" : "Connect resource"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
};
