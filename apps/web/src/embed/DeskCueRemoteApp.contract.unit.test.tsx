import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardStore } from "@modules/dashboard/model/store";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";
import type { DeskCueRuntime, DeskCueRuntimeFeatures } from "@runtime";

import { DeskCueRemoteApp } from "./DeskCueRemoteApp";

vi.mock("@components/ModalDialog", () => ({ ConfirmDialogHost: () => null }));
vi.mock("@components/AppToaster", () => ({ AppToaster: () => null }));
const appModuleRuntimeModes = vi.hoisted(() => [] as string[]);
vi.mock("@web/App", async () => {
  const { Link, useLocation } = await import("react-router");
  const { getDeskCueRuntime, useDeskCueRuntime } = await import("@runtime");
  const { useDeskCueEmbeddedReady, useDeskCueLayoutMode } = await import("@web/layout");
  appModuleRuntimeModes.push(getDeskCueRuntime().mode);
  return {
    DeskCueApp() {
      const runtime = useDeskCueRuntime();
      const layoutMode = useDeskCueLayoutMode();
      const onEmbeddedReady = useDeskCueEmbeddedReady();
      const location = useLocation();
      const [imperativeRuntimeMode, setImperativeRuntimeMode] = useState("pending");
      useEffect(() => {
        const timer = window.setTimeout(() => {
          setImperativeRuntimeMode(getDeskCueRuntime().mode);
        }, 0);
        return () => window.clearTimeout(timer);
      }, []);
      useEffect(() => onEmbeddedReady?.(), [onEmbeddedReady]);
      return (
        <div>
          <h2>DeskCue fixture</h2>
          <output aria-label="Selected session singleton">
            {dashboardStore.selectedSessionId || "none"}
          </output>
          <output aria-label="Opening agent singleton">
            {dashboardNavigationStore.openingAgentSessionId || "none"}
          </output>
          <output aria-label="DeskCue route">{runtime.readAppPath(location.pathname)}</output>
          <output aria-label="Imperative runtime">{imperativeRuntimeMode}</output>
          <output aria-label="DeskCue layout mode">{layoutMode}</output>
          <Link to={runtime.buildAppPath("/")}>DeskCue home</Link>
        </div>
      );
    }
  };
});

const READ_ONLY_FEATURES: DeskCueRuntimeFeatures = {
  accessSettings: false,
  cloudConnection: false,
  daemonLogs: false,
  externalHostProcessControls: false,
  localLlmChats: false,
  localRuntimes: false,
  manualRunner: false,
  notifications: false,
  preview: false,
  previewControl: false,
  realtime: false,
  sessionCommands: false,
  workspaceManagement: false
};

function runtime(machineId: string): DeskCueRuntime {
  const basename = `/machines/${machineId}/deskcue`;
  return {
    buildAppPath: (path) => `${basename}${path === "/" ? "/" : path}`,
    buildHttpUrl: (path) => `/v1/machines/${machineId}/deskcue${path}`,
    buildWebSocketUrl: (path) => `ws://localhost/v1/machines/${machineId}/deskcue${path}`,
    features: READ_ONLY_FEATURES,
    getAuthorizationToken: () => null,
    getCacheScope: () => null,
    getRealtimeScope: () => `cloud-machine:${machineId}`,
    mode: "cloud-machine",
    readAppPath: (pathname) => pathname.slice(basename.length) || "/",
    routerBasename: basename
  };
}

describe("DeskCueRemoteApp host routing contract", () => {
  beforeEach(() => {
    appModuleRuntimeModes.length = 0;
    dashboardStore.resetConnectionScopedState();
    dashboardNavigationStore.resetConnectionScopedState();
  });

  it("activates the host runtime before loading app singletons", async () => {
    const machineRuntime = runtime("machine-1");
    const onReady = vi.fn();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/machines/machine-1/deskcue/sessions/session-7"]}>
          <Routes>
            <Route
              path="/machines/:machineId/deskcue/*"
              element={(
                <>
                  <p>Cloud shell fixture</p>
                  <DeskCueRemoteApp onReady={onReady} runtime={machineRuntime} />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );

    expect(await screen.findByText("DeskCue fixture")).toBeInTheDocument();
    expect(appModuleRuntimeModes).toEqual(["cloud-machine"]);
    expect(await screen.findByLabelText("Imperative runtime"))
      .toHaveTextContent("cloud-machine");
    expect(screen.getByLabelText("DeskCue layout mode")).toHaveTextContent("embedded");
    expect(screen.getByText("Cloud shell fixture")).toBeInTheDocument();
    expect(screen.getByLabelText("DeskCue route")).toHaveTextContent("/sessions/session-7");
    expect(document.querySelectorAll("[data-deskcue-remote-root]")).toHaveLength(1);
    expect(onReady).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "DeskCue home" }));

    expect(screen.getByText("Cloud shell fixture")).toBeInTheDocument();
    expect(screen.getByLabelText("DeskCue route")).toHaveTextContent("/");
  });

  it("clears stale singleton state before mounting a remote machine", async () => {
    dashboardStore.setSelectedSessionId("session-from-another-machine");
    dashboardNavigationStore.setOpeningAgentSessionId("agent-from-another-machine");

    render(
      <MemoryRouter initialEntries={["/machines/machine-2/deskcue/"]}>
        <DeskCueRemoteApp runtime={runtime("machine-2")} />
      </MemoryRouter>
    );

    expect(await screen.findByLabelText("Selected session singleton"))
      .toHaveTextContent("none");
    expect(screen.getByLabelText("Opening agent singleton")).toHaveTextContent("none");
  });

  it("unmounts the old projection and resets it before switching machines", async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/machines/machine-1/deskcue/"]}>
        <DeskCueRemoteApp runtime={runtime("machine-1")} />
      </MemoryRouter>
    );
    expect(await screen.findByText("DeskCue fixture")).toBeInTheDocument();
    dashboardStore.setSelectedSessionId("machine-1-session");

    rerender(
      <MemoryRouter initialEntries={["/machines/machine-1/deskcue/"]}>
        <DeskCueRemoteApp runtime={runtime("machine-2")} />
      </MemoryRouter>
    );

    expect(await screen.findByLabelText("Selected session singleton"))
      .toHaveTextContent("none");
  });
});
