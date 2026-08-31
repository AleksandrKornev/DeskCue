import { Route, Routes } from "react-router";

import { AppErrorBoundary } from "@components/AppErrorBoundary/AppErrorBoundary";
import { AccessGate } from "@modules/accessGate/AccessGate";
import { RemoteAccessGate } from "@modules/accessGate/RemoteAccessGate";
import { useDeskCueRuntime } from "@runtime";
import { useDeskCueLayoutMode } from "@web/layout";

import { DeskCueRoutes } from "./pages/DeskCueRoutes";
import { LazyRoute } from "./pages/DeskCueRoutes/LazyRoute";
import { AccessRequiredPage, LogsPage, SettingsPage } from "./pages/lazyPages";

export function DeskCueApp() {
  const layoutMode = useDeskCueLayoutMode();
  const runtime = useDeskCueRuntime();

  const routes = (
    <Routes>
      {runtime.features.accessSettings ? (
        <Route path="connect" element={<LazyRoute><AccessRequiredPage /></LazyRoute>} />
      ) : null}
      {runtime.features.accessSettings ? (
        <Route path="settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
      ) : null}
      {runtime.features.daemonLogs ? (
        <Route path="logs" element={<LazyRoute><LogsPage /></LazyRoute>} />
      ) : null}
      <Route path="*" element={<DeskCueRoutes />} />
    </Routes>
  );

  return (
    <AppErrorBoundary embedded={layoutMode === "embedded"}>
      {runtime.mode === "local" ? (
        <AccessGate>{routes}</AccessGate>
      ) : (
        <RemoteAccessGate>{routes}</RemoteAccessGate>
      )}
    </AppErrorBoundary>
  );
}

export default DeskCueApp;
