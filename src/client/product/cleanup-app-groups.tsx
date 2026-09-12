import type { ProjectStatus } from "../../project/status-contract";
import { Button } from "../components/ui/button";
import { FormFeedback } from "./async-state";
import { useProductCommand } from "./data";

/** Retained runs remain stoppable even when configuration cannot be loaded. */
export const CleanupAppGroups = ({ status }: { status: ProjectStatus }) => {
  const command = useProductCommand();
  if (status.retainedCleanupTargets.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2>Retained App groups</h2>
      <p>These runs can be stopped without loading repository commands.</p>
      {status.retainedCleanupTargets.map((group) => {
        const worktree = status.worktrees.find(
          (item) => item.path === group.worktreePath
        );
        return (
          <div
            className="flex items-center justify-between gap-4"
            key={group.instanceId}
          >
            <span>{group.name}</span>
            <Button
              disabled={command.isPending || !worktree}
              onClick={() =>
                command.mutate({
                  appGroupName: `cleanup:${group.instanceId}`,
                  command: "stop-apps",
                  repoPath: status.repoPath,
                  worktreeId: worktree?.id,
                })
              }
              variant="outline"
            >
              Stop
            </Button>
          </div>
        );
      })}
      <FormFeedback error={command.error} />
    </section>
  );
};
