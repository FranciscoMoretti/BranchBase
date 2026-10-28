import { randomUUID } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "../adapters/persistence/json-file";
import { ExistingResourceSchema } from "./resource-contract";
import type { ExistingResource } from "./resource-contract";

const StoreSchema = z.strictObject({
  leases: z.record(z.string(), z.array(z.string())).default({}),
  profiles: z.record(z.string(), z.string()),
  resources: z.record(z.string(), ExistingResourceSchema),
  version: z.literal(1),
});

/** User-local selections and connections; never stores live health or secrets. */
export class ResourceStore {
  private readonly file: string;
  constructor(controlDirectory: string) {
    this.file = path.join(controlDirectory, "resources.json");
  }
  private read() {
    return StoreSchema.parse(
      readJsonFile(this.file) ?? { profiles: {}, resources: {}, version: 1 }
    );
  }
  hold(instanceIds: string[]): string {
    const data = this.read();
    const id = randomUUID();
    data.leases[id] = instanceIds;
    writeJsonFile(this.file, data);
    return id;
  }
  release(id: string): void {
    const data = this.read();
    Reflect.deleteProperty(data.leases, id);
    writeJsonFile(this.file, data);
  }
  lease(id: string): string[] {
    return this.read().leases[id] ?? [];
  }

  hasLease(instanceId: string): boolean {
    return Object.values(this.read().leases).some((ids) =>
      ids.includes(instanceId)
    );
  }

  profile(repoPath: string, worktreePath: string): string | null {
    return this.read().profiles[`${repoPath}\0${worktreePath}`] ?? null;
  }
  select(repoPath: string, worktreePath: string, profile: string | null): void {
    const data = this.read();
    const key = `${repoPath}\0${worktreePath}`;
    if (profile === null) {
      data.profiles = Object.fromEntries(
        Object.entries(data.profiles).filter(([storedKey]) => storedKey !== key)
      );
    } else {
      data.profiles[key] = profile;
    }
    writeJsonFile(this.file, data);
  }
  resources(): ExistingResource[] {
    return Object.values(this.read().resources);
  }
  resource(id: string): ExistingResource {
    const resource = this.read().resources[id];
    if (!resource) {
      throw new Error(
        `Connect existing resource "${id}" on this machine first.`
      );
    }
    return resource;
  }
  register(input: ExistingResource): void {
    const resource = ExistingResourceSchema.parse(input);
    const data = this.read();
    if (data.resources[resource.id]) {
      throw new Error(
        "A resource with this ID already exists. Use a new ID to avoid changing active connections."
      );
    }
    data.resources[resource.id] = resource;
    writeJsonFile(this.file, data);
  }
}
