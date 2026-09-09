import { Loader2Icon } from "lucide-react";

import { cn } from "@/client/lib/utils";

const Spinner = ({ className, ...props }: React.ComponentProps<"svg">) => (
  <Loader2Icon
    aria-label="Loading"
    aria-atomic="true"
    aria-live="polite"
    className={cn("size-4 animate-spin", className)}
    data-slot="spinner"
    {...props}
  />
);

export { Spinner };
