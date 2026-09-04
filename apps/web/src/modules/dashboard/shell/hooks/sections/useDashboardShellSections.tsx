import { Suspense } from "react";

import { AgentSessionsPanelLoading } from "@modules/agents";
import { DashboardHomeTabs } from "@modules/dashboard/shell/DashboardHomeTabs";
import {
  ManagedSessionShell
} from "@modules/dashboard/shell/ManagedSessionShell";
import { SecondaryToolsShell } from "@modules/dashboard/shell/SecondaryToolsShell";
import { getDeskCueRuntime } from "@runtime";

import {
  LazyAgentBrowserShell,
  LazyLiveSessionOverlay
} from "./dashboardShellLazyComponents";
import {
  buildAgentBrowserShellProps,
  buildManagedSessionShellProps,
  buildSecondaryToolsShellProps
} from "./helpers";
import type { UseDashboardShellSectionsArgs } from "./types";

export function useDashboardShellSections({
  overview,
  agentBrowser,
  managedSession,
  manualRunner,
  prompt,
  agentBrowserActions,
  managedSessionActions,
  manualRunnerActions,
  agentBrowserLoaders,
  route,
  routeActions
}: UseDashboardShellSectionsArgs) {
  const agentBrowserShellProps = buildAgentBrowserShellProps({
    overview,
    agentBrowser,
    managedSession,
    manualRunner,
    prompt,
    agentBrowserActions,
    manualRunnerActions,
    agentBrowserLoaders,
    route,
    routeActions
  });

  const managedSessionShellProps = buildManagedSessionShellProps({
    overview,
    agentBrowser,
    managedSession,
    prompt,
    agentBrowserActions,
    managedSessionActions,
    route,
    routeActions
  });

  const secondaryToolsShellProps = buildSecondaryToolsShellProps({
    overview,
    agentBrowser,
    manualRunner,
    manualRunnerActions
  });

  const shouldRenderAgentBrowser = !route.hasManagedFocus;
  const shouldRenderTools =
    route.showLiveTools ||
    route.activeLiveOverlay === "tools" ||
    !route.hasManagedFocus;
  const runtimeFeatures = getDeskCueRuntime().features;
  const hasSecondaryTools =
    runtimeFeatures.manualRunner ||
    runtimeFeatures.localRuntimes ||
    runtimeFeatures.workspaceManagement;
  const showSecondaryManagedSession =
    !route.isDashboardPinned && Boolean(route.effectiveSelectedSessionId);

  const agentBrowserPanelFallback = <AgentSessionsPanelLoading />;
  const secondaryToolsPanel = shouldRenderTools && hasSecondaryTools ? (
    <SecondaryToolsShell {...secondaryToolsShellProps} />
  ) : null;
  const focusedManagedSessionPanel = route.hasManagedFocus ? (
    <ManagedSessionShell
      {...managedSessionShellProps}
      onToggleTools={routeActions.onToggleLiveTools}
      showTools={route.showLiveTools}
    />
  ) : null;

  const secondaryManagedSessionPanel = showSecondaryManagedSession ? (
    <ManagedSessionShell {...managedSessionShellProps} />
  ) : null;
  const liveOverlay = route.activeLiveOverlay ? (
    <Suspense fallback={null}>
      <LazyLiveSessionOverlay
        onClose={routeActions.onCloseLiveOverlays}
        toolsContent={secondaryToolsPanel}
      />
    </Suspense>
  ) : null;

  return {
    agentBrowserShell: shouldRenderAgentBrowser ? (
      route.hasManagedFocus ? (
        <Suspense fallback={agentBrowserPanelFallback}>
          <LazyAgentBrowserShell
            {...agentBrowserShellProps}
            defaultCollapsed
          />
        </Suspense>
      ) : (
        <DashboardHomeTabs
          chatsContent={
            <Suspense fallback={agentBrowserPanelFallback}>
              <LazyAgentBrowserShell {...agentBrowserShellProps} />
            </Suspense>
          }

          toolsContent={secondaryToolsPanel}
        />
      )
    ) : null,
    focusedManagedSessionShell: focusedManagedSessionPanel,
    liveOverlay,
    secondaryManagedSessionShell: secondaryManagedSessionPanel,
    showSecondaryManagedSession
  };
}
