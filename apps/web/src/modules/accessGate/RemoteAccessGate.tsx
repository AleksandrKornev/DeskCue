import { useEffect } from "react";
import type { ReactNode } from "react";

import { API_UNAUTHORIZED_EVENT } from "@api/transport/httpClient";
import { clearCloudMachineDashboardCaches } from "@modules/dashboard/model/cache/storage";
import { useDeskCueRuntime } from "@runtime";

export function RemoteAccessGate({ children }: { children: ReactNode }) {
  const runtime = useDeskCueRuntime();
  useEffect(() => {
    clearCloudMachineDashboardCaches();
    const handleUnauthorized = () => {
      clearCloudMachineDashboardCaches();
      runtime.onUnauthorized?.();
    };
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [runtime]);

  return <>{children}</>;
}
