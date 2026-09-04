import { observer } from "mobx-react-lite";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { useDeskCueDashboard } from "@modules/dashboard/model";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";
import { useDeskCueRuntime } from "@runtime";

import { readRouteSessionId, readRouteSessionTab } from "./helpers";
import {
  DashboardPage,
  LocalLlmChatPage,
  ManagedSessionPage
} from "./lazyPages";
import { LazyRoute } from "./LazyRoute";

export const DeskCueRoutes = observer(function DeskCueRoutes() {
  const runtime = useDeskCueRuntime();
  const { features } = runtime;
  const appLocation = useLocation();
  const appPathname = runtime.readAppPath(appLocation.pathname);
  const isDashboardRoute = appPathname === "/";
  const routeSessionId = readRouteSessionId(appPathname);

  const dashboard = useDeskCueDashboard({
    initialActiveTab: readRouteSessionTab(appPathname),
    initialManagedSessionId: routeSessionId ?? undefined,
    suppressAgentSessionAutoSelect:
      dashboardNavigationStore.isAgentBrowserListMode ||
      (isDashboardRoute && !appLocation.search),
    suppressManagedSessionAutoSelect: isDashboardRoute
  });

  return (
    <Routes>
      <Route
        index
        element={
          <LazyRoute>
            <DashboardPage
              dashboard={dashboard}
            />
          </LazyRoute>
        }
      />
      {features.localLlmChats ? <Route
        path="local-llm/chats/:chatId"
        element={
          <LazyRoute>
            <LocalLlmChatPage dashboard={dashboard} />
          </LazyRoute>
        }
      /> : null}
      <Route
        path="sessions/:sessionId"
        element={
          <LazyRoute>
            <ManagedSessionPage
              dashboard={dashboard}
            />
          </LazyRoute>
        }
      />
      <Route
        path="sessions/:sessionId/:tab"
        element={
          <LazyRoute>
            <ManagedSessionPage
              dashboard={dashboard}
            />
          </LazyRoute>
        }
      />
      <Route path="*" element={<Navigate replace to={runtime.buildAppPath("/")} />} />
    </Routes>
  );
});
