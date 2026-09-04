import { render, screen } from "@testing-library/react";
import { lazy } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppPath: vi.fn((pathname: string) =>
    pathname.replace(/^\/machines\/[^/]+\/deskcue/, "") || "/")
}));

vi.mock("@runtime", () => ({
  useDeskCueRuntime: () => ({ readAppPath: mocks.readAppPath })
}));

const suspendedRouteModule = new Promise<{ default: () => null }>(() => {});
const SuspendedRoute = lazy(() => suspendedRouteModule);

import { LazyRoute } from "./LazyRoute";

describe("LazyRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies an embedded session route from its runtime-relative path", () => {
    render(
      <MemoryRouter initialEntries={["/machines/machine-1/deskcue/sessions/session-7"]}>
        <Routes>
          <Route
            path="/machines/:machineId/deskcue/*"
            element={
              <LazyRoute>
                <SuspendedRoute />
              </LazyRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(mocks.readAppPath)
      .toHaveBeenCalledWith("/machines/machine-1/deskcue/sessions/session-7");
    expect(screen.getByRole("status"))
      .toHaveAccessibleName("Loading source-agent chat");
  });
});
