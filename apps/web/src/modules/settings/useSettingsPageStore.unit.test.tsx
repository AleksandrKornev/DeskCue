import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessSettingsStore } from "./access/AccessSettingsTab/store";
import { DaemonSettingsStore } from "./daemonSettings";
import { useSettingsPageStore } from "./useSettingsPageStore";

function createRouterWrapper(initialEntry: string) {
  return function RouterWrapper({ children }: PropsWithChildren) {
    return (
      <StrictMode>
        <MemoryRouter initialEntries={[initialEntry]}>
          {children}
        </MemoryRouter>
      </StrictMode>
    );
  };
}

describe("useSettingsPageStore phone pairing route action", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens phone pairing from a one-shot route action and consumes the action", async () => {
    vi.spyOn(DaemonSettingsStore.prototype, "loadDaemonSettings")
      .mockImplementation(() => undefined);
    const createPairingLink = vi.spyOn(AccessSettingsStore.prototype, "createPairingLink")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const store = useSettingsPageStore();
      const location = useLocation();

      return { location, store };
    }, {
      wrapper: createRouterWrapper("/settings?tab=storage&action=pair-device&source=tray")
    });

    await waitFor(() => {
      expect(result.current.location.search).toBe("?tab=access&source=tray");
    });

    expect(result.current.store.activeTab).toBe("access");
    expect(createPairingLink).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown route actions", async () => {
    vi.spyOn(DaemonSettingsStore.prototype, "loadDaemonSettings")
      .mockImplementation(() => undefined);
    const createPairingLink = vi.spyOn(AccessSettingsStore.prototype, "createPairingLink")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const store = useSettingsPageStore();
      const location = useLocation();

      return { location, store };
    }, {
      wrapper: createRouterWrapper("/settings?tab=storage&action=unknown")
    });

    await waitFor(() => {
      expect(result.current.store.activeTab).toBe("storage");
    });

    expect(result.current.location.search).toBe("?tab=storage&action=unknown");
    expect(createPairingLink).not.toHaveBeenCalled();
  });
});
