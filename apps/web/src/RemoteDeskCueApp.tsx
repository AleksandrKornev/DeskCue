import { useLayoutEffect, useState } from "react";

import { clearConditionalJsonCache } from "@api/transport/requests";
import { AppErrorBoundary } from "@components/AppErrorBoundary/AppErrorBoundary";
import { RemoteAccessGate } from "@modules/accessGate/RemoteAccessGate";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail";
import { clearManagedSessionDetailRequestCache } from "@modules/dashboard/model/data/managedSessionRequests";
import { dashboardStore } from "@modules/dashboard/model/store";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";
import type { DeskCueRuntime } from "@runtime";
import { DeskCueRoutes } from "@web/pages/DeskCueRoutes";

export function RemoteDeskCueApp({ runtime }: { runtime: DeskCueRuntime }) {
  const [preparedRuntime, setPreparedRuntime] = useState<DeskCueRuntime | null>(null);

  useLayoutEffect(() => {
    // DeskCue currently owns singleton dashboard/resources. A host may switch the
    // mounted machine without reloading the page, so discard every in-memory
    // projection before allowing the new runtime to render or issue requests.
    clearConditionalJsonCache();
    clearManagedSessionDetailRequestCache();
    agentChatDetailResource.clear();
    dashboardStore.resetConnectionScopedState();
    dashboardNavigationStore.resetConnectionScopedState();
    setPreparedRuntime(runtime);
  }, [runtime]);

  if (preparedRuntime !== runtime) return null;

  return (
    <AppErrorBoundary embedded>
      <RemoteAccessGate>
        <DeskCueRoutes />
      </RemoteAccessGate>
    </AppErrorBoundary>
  );
}
