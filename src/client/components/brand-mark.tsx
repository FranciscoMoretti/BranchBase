import { cn } from "../lib/utils";

export const BrandMark = ({
  className,
  title = "BranchBase",
}: {
  className?: string;
  title?: string;
}) => (
  <svg
    aria-label={title}
    className={cn("brand-mark", className)}
    fill="none"
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The brand mark is an inline SVG with a caller-provided accessible name.
    role="img"
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M7 5v22" stroke="currentColor" strokeWidth="2" />
    <path
      d="M7 10h7c5 0 8-2 8-5M7 21h8c6 0 10 2 10 6"
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth="2"
    />
    <path d="M4 27h24" stroke="currentColor" strokeWidth="2" />
    <rect fill="currentColor" height="4" width="4" x="20" y="3" />
    <rect fill="currentColor" height="4" width="4" x="23" y="25" />
  </svg>
);

export const BrandWordmark = ({ compact = false }: { compact?: boolean }) => (
  <span className="brand-wordmark" data-compact={compact || undefined}>
    branchbase
  </span>
);
