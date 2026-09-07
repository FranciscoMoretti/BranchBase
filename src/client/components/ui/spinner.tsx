import { Loader2Icon } from "lucide-react";

import { cn } from "@/client/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      data-slot="spinner"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Spinner is an inline SVG component; wrapping it in output would change its icon API and layout.
      role="status"
      {...props}
    />
  );
}

export { Spinner };
