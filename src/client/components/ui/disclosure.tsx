import type { ReactNode } from "react";

export const Disclosure = ({
  summary,
  children,
  className,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) => (
  <details className={className}>
    <summary>{summary}</summary>
    {children}
  </details>
);
