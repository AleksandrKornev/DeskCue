import { Suspense } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { RouteLoadingShell } from "@modules/appShell";

type LazyRouteProps = {
  children: ReactNode;
};

export function LazyRoute({
  children
}: LazyRouteProps) {
  const location = useLocation();

  return (
    <Suspense
      fallback={
        <RouteLoadingShell
          pathname={location.pathname}
          search={location.search}
        />
      }
    >
      {children}
    </Suspense>
  );
}
