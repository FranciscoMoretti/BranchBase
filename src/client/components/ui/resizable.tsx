import { useId } from "react";
import {
  Group,
  type GroupProps,
  Panel,
  type PanelProps,
  Separator,
  type SeparatorProps,
  useDefaultLayout,
} from "react-resizable-panels";

import { cn } from "@/client/lib/utils";

function ResizablePanelGroup({
  autoSaveId,
  className,
  direction = "horizontal",
  panelIds,
  ...props
}: Omit<GroupProps, "orientation"> & {
  autoSaveId?: string;
  direction?: "horizontal" | "vertical";
  panelIds?: string[];
}) {
  const fallbackId = useId();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId ?? fallbackId,
    onlySaveAfterUserInteractions: true,
    panelIds,
  });
  return (
    <Group
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      data-slot="resizable-panel-group"
      defaultLayout={defaultLayout}
      id={autoSaveId}
      onLayoutChanged={onLayoutChanged}
      orientation={direction}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "bg-border ring-offset-background focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      data-slot="resizable-handle"
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-6 w-1 shrink-0 rounded-none" />
      )}
    </Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
