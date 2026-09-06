import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DevelopmentFolderSchema } from "./discovery-contract";
import { type AppPin, ProjectRecordSchema } from "./product-contract";

const StoreSchema = z.strictObject({
  folders: z.array(DevelopmentFolderSchema).default([]),
  excludedPaths: z.array(z.string()).default([]),
  projects: z.array(ProjectRecordSchema),
  version: z.literal(1),
});

export class ProductCatalogError extends Error {
  readonly code = "invalid_product_catalog";
  readonly file: string;
  readonly cause: unknown;

  constructor(file: string, cause: unknown) {
    super(
      `BranchBase could not read a valid project catalog at ${file}. ` +
        "The file was left unchanged; repair or restore it before retrying."
    );
    this.file = file;
    this.cause = cause;
    this.name = "ProductCatalogError";
  }
}

/** Product metadata is separate from runtime ownership and never authorizes commands. */
export class ProductStore {
  private readonly file: string;
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    this.file = join(directory, "product.json");
  }
  private read(): z.infer<typeof StoreSchema> {
    if (!existsSync(this.file)) {
      return StoreSchema.parse({
        projects: [],
        version: 1,
      });
    }
    try {
      return StoreSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (error) {
      throw new ProductCatalogError(this.file, error);
    }
  }
  private write(value: z.infer<typeof StoreSchema>): void {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
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
    state.folders.push({ path, addedAt: new Date().toISOString() });
    this.write(state);
  }
  removeFolder(path: string) {
    const state = this.read();
    state.folders = state.folders.filter((folder) => folder.path !== path);
    this.write(state);
  }
}
