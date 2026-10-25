import { cn } from "../lib/utils";

export const BrandMark = ({
  className,
  title = "Brum",
  pose = "ready",
  variant = "mascot",
}: {
  className?: string;
  title?: string;
  pose?: "ready" | "running" | "resting";
  variant?: "mascot" | "icon";
}) => (
  <img
    alt={title}
    className={cn("brand-mark", className)}
    height={variant === "icon" ? 32 : 384}
    src={
      variant === "icon"
        ? "/brand/brum-engine-32.png"
        : `/brand/brum-${pose}.webp`
    }
    srcSet={
      variant === "icon"
        ? "/brand/brum-engine-64.png 2x, /brand/brum-engine-96.png 3x"
        : undefined
    }
    width={variant === "icon" ? 32 : 384}
  />
);

export const BrandWordmark = ({ compact = false }: { compact?: boolean }) => (
  <span className="brand-wordmark" data-compact={compact || undefined}>
    brum
  </span>
);
