import type { ReactNode } from "react";

export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={className}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
