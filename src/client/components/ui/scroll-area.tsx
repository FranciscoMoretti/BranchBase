import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { Ref } from "react";

import { cn } from "@/client/lib/utils";

const DEFAULT_SCROLLBARS = ["vertical"] satisfies ("horizontal" | "vertical")[];

interface ScrollAreaProps extends ScrollAreaPrimitive.Root.Props {
  scrollbars?: ("horizontal" | "vertical")[];
  viewportRef?: Ref<HTMLDivElement>;
}

const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) => (
  <ScrollAreaPrimitive.Scrollbar
    className={cn(
      "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
      className
    )}
    data-orientation={orientation}
    data-slot="scroll-area-scrollbar"
    orientation={orientation}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb
      className="bg-border relative flex-1 rounded-none"
      data-slot="scroll-area-thumb"
    />
  </ScrollAreaPrimitive.Scrollbar>
);

const ScrollArea = ({
  className,
  children,
  scrollbars = DEFAULT_SCROLLBARS,
  viewportRef,
  ...props
}: ScrollAreaProps) => (
  <ScrollAreaPrimitive.Root
    className={cn("relative", className)}
    data-slot="scroll-area"
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      data-slot="scroll-area-viewport"
      ref={viewportRef}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    {scrollbars.map((orientation) => (
      <ScrollBar key={orientation} orientation={orientation} />
    ))}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
);

export { ScrollArea, ScrollBar };
