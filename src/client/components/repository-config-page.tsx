import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BranchBaseConfigSchema } from "../../config/branchbase-schema";
import type { BranchBaseConfig } from "../../config/branchbase-schema";
import {
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "../config-draft";
import { FormFeedback } from "../product/async-state";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function RepositoryConfigPage({
  config,
  configPath,
  error,
  navigationRequest,
  onClose,
  onDirtyChange,
  onSave,
  pending,
}: {
  config: BranchBaseConfig;
  configPath: string;
  error: Error | null;
  navigationRequest: number;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (value: BranchBaseConfig) => Promise<void>;
  pending: boolean;
}) {
  const original = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const [source, setSource] = useState(
    () => loadConfigDraft(configPath, original) ?? original
  );
  const [discardRequested, setDiscardRequested] = useState(false);
  const [ignoredNavigationRequest, setIgnoredNavigationRequest] =
    useState(navigationRequest);
  const parsed = useMemo(() => {
    try {
      return BranchBaseConfigSchema.safeParse(JSON.parse(source));
    } catch (caught) {
      return {
        message: caught instanceof Error ? caught.message : "Invalid JSON",
        success: false as const,
      };
    }
  }, [source]);
  const dirty = source !== original;

  useEffect(() => {
    if (dirty) {
      saveConfigDraft(configPath, original, source);
    } else {
      clearConfigDraft(configPath);
    }
  }, [configPath, dirty, original, source]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const discardOpen =
    discardRequested || (dirty && navigationRequest > ignoredNavigationRequest);

  let validationMessage: string | null = null;
  if (!parsed.success) {
    validationMessage =
      "message" in parsed
        ? parsed.message
        : parsed.error.issues
            .slice(0, 4)
            .map(
              (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`
            )
            .join("; ");
  }

  function requestClose() {
    if (dirty) {
      setDiscardRequested(true);
    } else {
      onClose();
    }
  }

  function keepEditing(): void {
    setDiscardRequested(false);
    setIgnoredNavigationRequest(navigationRequest);
  }

  async function saveConfiguration(): Promise<void> {
    if (!parsed.success) {
      return;
    }
    try {
      await onSave(parsed.data);
      clearConfigDraft(configPath);
    } catch {
      // The parent presents the save error; retain the editable draft.
    }
  }

  function discardChanges(): void {
    clearConfigDraft(configPath);
    onClose();
  }

  return (
    <section className="bg-background flex min-w-0 flex-col">
      <header className="bg-background shrink-0 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-start gap-3 px-6 py-5">
          <Button
            aria-label="Back to project settings"
            onClick={requestClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="font-heading text-xl font-medium">Configuration</h1>
            <p className="text-muted-foreground text-sm">
              Checked-in App groups, lifecycle commands, environment templates,
              and readiness.
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
          <div>
            <p className="font-medium">{configPath}</p>
            <p className="text-muted-foreground text-sm">
              HTTP Apps receive stable Friendly URLs and dynamic backing ports.
              Use tokens such as {"{apps.web.port}"} and {"{apps.web.url}"} in
              group environment variables. Set an app group&apos;s category to
              &quot;infrastructure&quot; to include its instances in the
              Infrastructure tab.
            </p>
          </div>
          <Textarea
            aria-label="BranchBase configuration JSON"
            className="min-h-[32rem] font-mono text-sm"
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            value={source}
          />
          <FormFeedback
            error={validationMessage ? new Error(validationMessage) : error}
            title={
              validationMessage
                ? "Configuration needs attention"
                : "Could not save configuration"
            }
          />
        </div>
      </div>
      <footer className="bg-background shrink-0 border-t">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2 px-6 py-4">
          {discardOpen ? (
            <>
              <p className="text-muted-foreground mr-auto">
                Discard unsaved configuration changes?
              </p>
              <Button onClick={keepEditing} variant="outline">
                Keep editing
              </Button>
              <Button onClick={discardChanges} variant="destructive">
                Discard changes
              </Button>
            </>
          ) : (
            <>
              <Button onClick={requestClose} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={!(dirty && parsed.success) || pending}
                onClick={saveConfiguration}
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}
