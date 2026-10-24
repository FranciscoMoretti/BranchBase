import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import type { Observation } from "../../project/discovery-contract";
import { DeleteWorktreeDialog } from "../components/delete-worktree-dialog";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useCommand } from "../mutations";

export const ObservedWorktreeActions = ({
  worktree,
  repoPath,
}: {
  worktree: Observation["worktrees"][number];
  repoPath: string;
}) => {
  const [deleting, setDeleting] = useState(false);
  const mutation = useCommand("delete-worktree", repoPath);
  if (worktree.isMain) {
    return null;
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${worktree.branch}`}
              size="icon"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={worktree.services.length > 0}
              variant="destructive"
              onClick={() => setDeleting(true)}
            >
              Delete worktree
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting ? (
        <DeleteWorktreeDialog
          mutation={mutation}
          onClose={() => setDeleting(false)}
          repoPath={repoPath}
          worktree={worktree}
          disk={worktree.disk}
        />
      ) : null}
    </>
  );
};
