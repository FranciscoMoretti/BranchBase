import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type AppPin, ProjectRecordSchema } from "./product-contract";

const StoreSchema = z.strictObject({
  projects: z.array(ProjectRecordSchema),
  version: z.literal(1),
});

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
    return StoreSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
  }
  private write(value: z.infer<typeof StoreSchema>): void {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  projects() {
    return this.read().projects;
  }
  saveProject(path: string, name: string, pins?: AppPin[]): void {
    const state = this.read();
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
    state.projects = state.projects.filter((project) => project.path !== path);
    this.write(state);
  }
}
