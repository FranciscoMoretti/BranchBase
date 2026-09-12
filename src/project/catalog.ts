import { randomUUID } from "node:crypto";
import pathModule from "node:path";

import { z } from "zod";

import { observeGroups, observeWorktreeFields } from "../activity/history";
import { readJsonFile, writeJsonFile } from "../adapters/persistence/json-file";
import { ActivityEventSchema, ProjectRecordSchema } from "./catalog-contract";
import type { ActivityEvent, AppPin } from "./catalog-contract";
import { ProductCatalogError } from "./catalog-error";
import { DevelopmentFolderSchema } from "./discovery-contract";
import type { Observation as RepositoryObservation } from "./discovery-contract";
import type { WorkspaceSnapshot } from "./worktree-status-contract";

export { ProductCatalogError } from "./catalog-error";

const StoreSchema = z.strictObject({
  detected: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  events: z.array(ActivityEventSchema).default([]),
  excludedPaths: z.array(z.string()).default([]),
  folders: z.array(DevelopmentFolderSchema).default([]),
  observations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default({}),
  projects: z.array(ProjectRecordSchema),
  version: z.literal(1),
});

export class ProductStore {
  private readonly file: string;
  constructor(directory: string) {
    this.file = pathModule.join(directory, "product.json");
  }
  private read(): z.infer<typeof StoreSchema> {
    try {
      return StoreSchema.parse(
        readJsonFile(this.file) ?? { projects: [], version: 1 }
      );
    } catch (error) {
      throw new ProductCatalogError(this.file, error);
    }
  }
  private write(value: z.infer<typeof StoreSchema>): void {
    writeJsonFile(this.file, value);
  }
  projects() {
    return this.read().projects;
  }
  saveProject(path: string, name: string, pins?: AppPin[]): void {
    const state = this.read();
    state.excludedPaths = state.excludedPaths.filter((value) => value !== path);
    const existing = state.projects.find((project) => project.path === path);
    const record = ProjectRecordSchema.parse({
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      name,
      path,
      pins: pins ?? existing?.pins ?? [],
    });
    state.projects = existing
      ? state.projects.map((project) =>
          project.path === path ? record : project
        )
      : [...state.projects, record];
    this.write(state);
  }
  removeProject(path: string): void {
    const state = this.read();
    state.excludedPaths = [...new Set([...state.excludedPaths, path])];
    state.projects = state.projects.filter((project) => project.path !== path);
    this.write(state);
  }
  folders() {
    return this.read().folders;
  }
  excludedPaths() {
    return this.read().excludedPaths;
  }
  saveFolder(path: string) {
    const state = this.read();
    if (state.folders.some((folder) => folder.path === path)) {
      return;
    }
    if (state.folders.length >= 20) {
      throw new Error(
        "You can watch up to 20 development folders. Remove one before adding another."
      );
    }
    state.folders.push({ addedAt: new Date().toISOString(), path });
    this.write(state);
  }
  removeFolder(path: string) {
    const state = this.read();
    state.folders = state.folders.filter((folder) => folder.path !== path);
    this.write(state);
  }
  observeDetected(observation: RepositoryObservation) {
    const state = this.read();
    const previous = state.detected[observation.repoPath];
    const current: Record<string, string> = {};
    for (const worktree of observation.worktrees) {
      current[`worktree:${worktree.id}`] = worktree.branch;
      for (const service of worktree.services.filter((item) => !item.managed)) {
        current[`service:${worktree.id}:${service.pid}:${service.port}`] =
          `${worktree.branch} · ${service.command} on port ${service.port}`;
      }
    }
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return;
    }
    if (previous) {
      for (const key of new Set([
        ...Object.keys(previous),
        ...Object.keys(current),
      ])) {
        if (previous[key] === current[key]) {
          continue;
        }
        // Configured workspace inspection already records worktree discovery.
        if (key.startsWith("worktree:") && observation.configured) {
          continue;
        }
        const action = current[key] ? "Detected" : "No longer detected";
        const [, worktreeId] = key.split(":");
        const discoveryEventId = randomUUID();
        const discoveryEventAt = new Date().toISOString();
        state.events.push({
          at: discoveryEventAt,
          id: discoveryEventId,
          kind: "discovery",
          message: `${action}: ${current[key] ?? previous[key]}`,
          repoPath: observation.repoPath,
          severity: "info",
          worktreeId,
          worktreeName:
            current[`worktree:${worktreeId}`] ??
            previous[`worktree:${worktreeId}`],
        });
      }
    }
    state.detected[observation.repoPath] = current;
    state.events = state.events.slice(-2000);
    this.write(state);
  }
  events(repoPath?: string): ActivityEvent[] {
    return this.read()
      .events.filter((event) => !repoPath || event.repoPath === repoPath)
      .toReversed();
  }
  append(event: Omit<ActivityEvent, "id" | "at">): void {
    const state = this.read();
    state.events.push({
      ...event,
      at: new Date().toISOString(),
      id: randomUUID(),
    });
    state.events = state.events.slice(-2000);
    this.write(state);
  }
  observe(workspace: WorkspaceSnapshot): void {
    const state = this.read();
    const previous = state.observations[workspace.repoPath];
    const current: Record<string, string> = {};
    const events: Omit<ActivityEvent, "id" | "at">[] = [];
    const observation = {
      current,
      events,
      previous,
      repoPath: workspace.repoPath,
      seen: new Set<string>(),
    };
    for (const worktree of workspace.worktrees) {
      observeWorktreeFields(worktree, observation);
      observeGroups(worktree, observation);
    }
    for (const [key, branch] of Object.entries(previous ?? {})) {
      if (key.startsWith("worktree:") && !(key in current)) {
        events.push({
          kind: "discovery",
          message: "Worktree no longer discovered",
          repoPath: workspace.repoPath,
          severity: "info",
          worktreeId: key.slice("worktree:".length),
          worktreeName: branch,
        });
      }
    }
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return;
    }
    state.observations[workspace.repoPath] = current;
    state.events.push(
      ...events.map((event) => ({
        ...event,
        at: new Date().toISOString(),
        id: randomUUID(),
      }))
    );
    state.events = state.events.slice(-2000);
    this.write(state);
  }
}
