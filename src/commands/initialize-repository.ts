import type { WorkspaceController } from "../controller/workspace-controller";
import { requiredString } from "./command";

export const initializeRepository = (
  controller: WorkspaceController,
  input: Record<string, unknown>
) =>
  controller.initializeRepository(
    requiredString(input.repoPath, "Repository path")
  );
