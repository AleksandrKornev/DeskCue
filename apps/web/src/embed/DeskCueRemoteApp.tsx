import clsx from "clsx";
import { lazy, Suspense, useLayoutEffect, useState } from "react";

import { clearConditionalJsonCache } from "@api/transport/requests";
import { AppToaster } from "@components/AppToaster";
import { ConfirmDialogHost } from "@components/ModalDialog";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail";
import { clearManagedSessionDetailRequestCache } from "@modules/dashboard/model/data/managedSessionRequests";
import { dashboardStore } from "@modules/dashboard/model/store";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";
import { DeskCueRuntimeProvider } from "@runtime";
import type { DeskCueRuntime } from "@runtime";
import { DeskCueLayoutModeProvider } from "@web/layout";

import styles from "./DeskCueRemoteApp.module.scss";

const LazyDeskCueApp = lazy(async () => {
  const module = await import("@web/App");
  return { default: module.DeskCueApp };
});

export function DeskCueRemoteApp({
  className,
  onReady,
  runtime
}: {
  className?: string;
  onReady?: () => void;
  runtime: DeskCueRuntime;
}) {
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

  if (runtime.mode === "local") throw new Error("DeskCueRemoteApp requires a remote runtime.");

  return (
    <DeskCueRuntimeProvider runtime={runtime}>
      {preparedRuntime === runtime ? (
        <DeskCueLayoutModeProvider mode="embedded" onEmbeddedReady={onReady}>
          <section
            className={clsx(styles.remoteRoot, className)}
            data-deskcue-remote-root=""
          >
            <Suspense fallback={null}>
              <LazyDeskCueApp />
            </Suspense>
            <ConfirmDialogHost />
            <AppToaster />
          </section>
        </DeskCueLayoutModeProvider>
      ) : null}
    </DeskCueRuntimeProvider>
  );
}
