import { planRepositoryInitialization } from "../../configuration/initializer";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const previewRepositoryConfig = (
  _controller: WorkspaceController,
  input: Record<string, unknown>
) =>
  planRepositoryInitialization(
    requiredString(input.repoPath, "Repository path")
  );
