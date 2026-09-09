import { FolderGit2Icon, FolderOpenIcon } from "lucide-react";
import type { FormEvent } from "react";

import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { FormFeedback } from "../product/async-state";
import { useRepositoryOpen } from "../use-repository-open";
import { useRepositoryPicker } from "../use-repository-picker";
import { useRepositorySetup } from "../use-repository-setup";
import { BrandMark, BrandWordmark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { EmptyMedia } from "./ui/empty";
import { Field, FieldGroup, FieldLabel, FieldTitle } from "./ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

export const Onboarding = ({
  initialError,
  onDraftChange,
  onOpened,
  recents,
  repoDraft,
}: {
  initialError: Error | null;
  onDraftChange: (value: string) => void;
  onOpened: (path: string, snapshot: WorkspaceSnapshot) => void;
  recents: string[];
  repoDraft: string;
}) => {
  const opener = useRepositoryOpen(onOpened, initialError);
  const changeDraft = (path: string) => {
    opener.clearError();
    onDraftChange(path);
  };
  const picker = useRepositoryPicker();
  const openSelected = async (path: string) => {
    changeDraft(path);
    picker.clearError();
    await opener.open(path);
  };
  const setup = useRepositorySetup({
    error: opener.error,
    onCreated: () => opener.open(repoDraft.trim()),
    repoPath: repoDraft.trim(),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const path = repoDraft.trim();
    if (!path) {
      return;
    }
    await opener.open(path);
  };
  const feedback = () => {
    if (setup.active) {
      return setup.notice();
    }
    return (
      <FormFeedback
        error={opener.error ?? (picker.error ? new Error(picker.error) : null)}
        title="Could not open project"
      />
    );
  };
  return (
    <main className="onboarding-shell brand-canvas min-h-screen">
      <header className="onboarding-header">
        <span className="flex items-center gap-3">
          <span className="brand-lockup-mark grid size-10 place-items-center">
            <BrandMark className="size-6" />
          </span>
          <BrandWordmark />
        </span>
        <ThemeToggle />
      </header>
      <div className="onboarding-layout">
        <section className="onboarding-story">
          <div className="onboarding-eyebrow">
            Local development control plane
          </div>
          <h1>
            Your branches,
            <br />
            ready to run.
          </h1>
          <p>
            Start Apps, open Friendly URLs, inspect logs, and resume Codex tasks
            from one calm workspace.
          </p>
          <div aria-hidden="true" className="branch-topology">
            <div className="topology-row" data-state="ready">
              <span className="topology-branch">main</span>
              <span className="topology-line" />
              <span className="topology-state">Ready</span>
              <span className="topology-url">web.main.acme.localhost</span>
            </div>
            <div className="topology-row" data-state="ready">
              <span className="topology-branch">feature/auth</span>
              <span className="topology-line" />
              <span className="topology-state">Ready</span>
              <span className="topology-url">
                web.feature-auth.acme.localhost
              </span>
            </div>
            <div className="topology-row" data-state="stopped">
              <span className="topology-branch">fix/login</span>
              <span className="topology-line" />
              <span className="topology-state">Stopped</span>
              <span className="topology-url">—</span>
            </div>
          </div>
        </section>
        <Card className="onboarding-card">
          <CardHeader>
            <EmptyMedia variant="icon">
              <FolderGit2Icon />
            </EmptyMedia>
            <CardTitle>Open a repository</CardTitle>
            <CardDescription>
              BranchBase discovers existing worktrees from{" "}
              <code>.branchbase.json</code>, or helps you review a safe starter
              configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="onboarding-repo-path">
                    Repository path
                  </FieldLabel>
                  <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                    <InputGroup>
                      <InputGroupAddon htmlFor="onboarding-repo-path">
                        <FolderGit2Icon />
                      </InputGroupAddon>
                      <InputGroupInput
                        autoFocus
                        disabled={opener.pending || picker.pending}
                        id="onboarding-repo-path"
                        onChange={(event) => {
                          changeDraft(event.target.value);
                          picker.clearError();
                        }}
                        placeholder="/Users/you/code/project"
                        value={repoDraft}
                      />
                    </InputGroup>
                    <Button
                      aria-label="Choose repository folder"
                      disabled={opener.pending || picker.pending}
                      onClick={() => picker.handleBrowse(openSelected)}
                      variant="outline"
                    >
                      <FolderOpenIcon data-icon="inline-start" />
                      {picker.pending ? "Opening…" : "Browse"}
                    </Button>
                  </div>
                </Field>
                {feedback()}
                <Button
                  className="w-full"
                  disabled={
                    repoDraft.trim() === "" || opener.pending || picker.pending
                  }
                  type="submit"
                >
                  {opener.pending ? "Inspecting…" : "Open repository"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
          {recents.length > 0 ? (
            <CardFooter className="flex-col items-stretch gap-1">
              <FieldTitle>Recent repositories</FieldTitle>
              {recents.map((path) => (
                <Button
                  className="w-full justify-start truncate"
                  disabled={opener.pending || picker.pending}
                  key={path}
                  onClick={() => openSelected(path)}
                  variant="ghost"
                >
                  <FolderGit2Icon data-icon="inline-start" />
                  {path}
                </Button>
              ))}
            </CardFooter>
          ) : null}
        </Card>
      </div>
      <footer className="onboarding-footer">
        <span>Runs on your machine</span>
        <span>Repository commands require explicit trust</span>
      </footer>
      {setup.dialog}
    </main>
  );
};
