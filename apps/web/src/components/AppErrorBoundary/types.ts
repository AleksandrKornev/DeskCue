import type { ReactNode } from "react";

export type AppErrorBoundaryProps = {
  children: ReactNode;
  embedded?: boolean;
};

export type AppErrorBoundaryState = {
  failed: boolean;
};
