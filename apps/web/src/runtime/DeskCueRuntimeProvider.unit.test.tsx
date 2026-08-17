import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  getDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "./config";
import {
  DeskCueRuntimeProvider
} from "./DeskCueRuntimeProvider";
import { useDeskCueRuntime } from "./useDeskCueRuntime";

function RuntimeProbe() {
  return <output aria-label="Active runtime">{getDeskCueRuntime().mode}</output>;
}

function RuntimeScopeProbe() {
  const contextRuntime = useDeskCueRuntime();
  const contextScope = contextRuntime.getRealtimeScope();
  const imperativeScope = getDeskCueRuntime().getRealtimeScope();
  if (contextScope !== imperativeScope) {
    throw new Error("runtime consumers are out of sync");
  }
  return <output aria-label="Active runtime scope">{contextScope}</output>;
}

function ThrowDuringRender(): ReactNode {
  throw new Error("render aborted");
}

describe("DeskCueRuntimeProvider", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    resetDeskCueRuntimeForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes a committed runtime to imperative consumers and releases it on unmount", () => {
    const runtime = createCloudMachineDeskCueRuntime(window.location);
    const view = render(
      <DeskCueRuntimeProvider runtime={runtime}>
        <RuntimeProbe />
      </DeskCueRuntimeProvider>
    );

    expect(screen.getByLabelText("Active runtime")).toHaveTextContent("cloud-machine");

    view.unmount();

    expect(getDeskCueRuntime().mode).toBe("local");
  });

  it("does not leak a runtime from a render that never commits", () => {
    const runtime = createCloudMachineDeskCueRuntime(window.location);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(
      <>
        <DeskCueRuntimeProvider runtime={runtime}>
          <RuntimeProbe />
        </DeskCueRuntimeProvider>
        <ThrowDuringRender />
      </>
    )).toThrow("render aborted");

    expect(getDeskCueRuntime().mode).toBe("local");
  });

  it("keeps Context and imperative consumers synchronized when runtime changes", () => {
    const firstRuntime = createCloudMachineDeskCueRuntime(window.location);
    window.history.replaceState({}, "", "/machines/machine-02/deskcue/");
    const secondRuntime = createCloudMachineDeskCueRuntime(window.location);
    const view = render(
      <DeskCueRuntimeProvider runtime={firstRuntime}>
        <RuntimeScopeProbe />
      </DeskCueRuntimeProvider>
    );

    expect(screen.getByLabelText("Active runtime scope"))
      .toHaveTextContent("cloud-machine:machine-01");

    view.rerender(
      <DeskCueRuntimeProvider runtime={secondRuntime}>
        <RuntimeScopeProbe />
      </DeskCueRuntimeProvider>
    );

    expect(screen.getByLabelText("Active runtime scope"))
      .toHaveTextContent("cloud-machine:machine-02");
  });
});
