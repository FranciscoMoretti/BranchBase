import type { ReactNode } from "react";

export const Disclosure = ({
  summary,
  children,
  className,
  open,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  open?: boolean;
}) => (
  <details className={className} open={open}>
    <summary>{summary}</summary>
    {children}
  </details>
);
