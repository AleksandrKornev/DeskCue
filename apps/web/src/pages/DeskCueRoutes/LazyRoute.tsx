import { Suspense } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { RouteLoadingShell } from "@modules/appShell";
import { useDeskCueRuntime } from "@runtime";

type LazyRouteProps = {
  children: ReactNode;
};

export function LazyRoute({
  children
}: LazyRouteProps) {
  const location = useLocation();
  const runtime = useDeskCueRuntime();

  return (
    <Suspense
      fallback={
        <RouteLoadingShell
          pathname={runtime.readAppPath(location.pathname)}
          search={location.search}
        />
      }
    >
      {children}
    </Suspense>
  );
}
