import clsx from "clsx";
import { lazy, Suspense } from "react";

import { AppToaster } from "@components/AppToaster";
import { ConfirmDialogHost } from "@components/ModalDialog";
import { DeskCueRuntimeProvider } from "@runtime";
import type { DeskCueRuntime } from "@runtime";
import { DeskCueLayoutModeProvider } from "@web/layout";

import styles from "./DeskCueRemoteApp.module.scss";

const LazyDeskCueApp = lazy(async () => {
  const module = await import("@web/RemoteDeskCueApp");

  return { default: module.RemoteDeskCueApp };
});

function assertSupportedRemoteRoutes(runtime: DeskCueRuntime) {
  if (!runtime.features.accessSettings && !runtime.features.daemonLogs) return;

  throw new Error("DeskCueRemoteApp does not include local-only access, settings, or logs routes.");
}

export function DeskCueRemoteApp({
  className,
  onReady,
  runtime
}: {
  className?: string;
  onReady?: () => void;
  runtime: DeskCueRuntime;
}) {
  if (runtime.mode === "local") throw new Error("DeskCueRemoteApp requires a remote runtime.");

  assertSupportedRemoteRoutes(runtime);

  return (
    <DeskCueRuntimeProvider runtime={runtime}>
      <DeskCueLayoutModeProvider mode="embedded" onEmbeddedReady={onReady}>
        <section
          className={clsx(styles.remoteRoot, className)}
          data-deskcue-remote-root=""
        >
          <Suspense fallback={null}>
            <LazyDeskCueApp runtime={runtime} />
          </Suspense>
          <ConfirmDialogHost />
          <AppToaster />
        </section>
      </DeskCueLayoutModeProvider>
    </DeskCueRuntimeProvider>
  );
}
