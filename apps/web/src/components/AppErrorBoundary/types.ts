import type { ReactNode } from "react";

export type AppErrorBoundaryProps = {
  children: ReactNode;
};

export type AppErrorBoundaryState = {
  failed: boolean;
};
