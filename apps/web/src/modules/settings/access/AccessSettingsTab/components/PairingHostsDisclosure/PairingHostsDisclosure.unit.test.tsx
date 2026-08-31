import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observable } from "mobx";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onRemovePairingHost: vi.fn()
}));

const daemonSettings = {
  pairingHosts: ["http://192.168.1.50:4173", "https://deskcue.example.com"],
  settingsFilePath: "C:\\DeskCue\\daemon-settings.json",
  sources: {
    pairingHosts: {},
    publicHost: {}
  }
};

const daemonSettingsDraft = observable({
  pairingHosts: ["http://192.168.1.50:4173", "https://deskcue.example.com"],
  publicHost: ""
});

function createNullableValue<T>(value: T): T | null {
  return value;
}

const accessStore = observable({
  addPairingHost: vi.fn(),
  daemonSettings: createNullableValue(daemonSettings),
  daemonSettingsDraft: createNullableValue(daemonSettingsDraft),
  onPairingHostChange: vi.fn(),
  onPublicHostChange: vi.fn(),
  onRemovePairingHost: mocks.onRemovePairingHost,
  onSaveDaemonSettings: vi.fn(),
  pairingHostsHandledFocusRequest: 0,
  acknowledgePairingHostsFocusRequest(request: number) {
    if (request <= accessStore.pairingHostsHandledFocusRequest) return;

    accessStore.pairingHostsHandledFocusRequest = request;
  },
  shouldHandlePairingHostsFocusRequest(request: number) {
    return request > accessStore.pairingHostsHandledFocusRequest;
  },
  pairingHostsFocusRequest: 0
});

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({ accessStore })
}));

vi.mock("@modules/settings/shared/SettingSourceDetails", () => ({
  SettingSourceDetails: () => <div>Setting source</div>
}));

import { PairingHostsDisclosure } from "./PairingHostsDisclosure";

function setDraftPairingHosts(hosts: string[]) {
  daemonSettingsDraft.pairingHosts.splice(
    0,
    daemonSettingsDraft.pairingHosts.length,
    ...hosts
  );
}

describe("PairingHostsDisclosure accessibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    accessStore.daemonSettings = daemonSettings;
    accessStore.daemonSettingsDraft = daemonSettingsDraft;
    setDraftPairingHosts([
      "http://192.168.1.50:4173",
      "https://deskcue.example.com"
    ]);
    accessStore.pairingHostsHandledFocusRequest = 0;
    accessStore.pairingHostsFocusRequest = 0;
    mocks.onRemovePairingHost.mockReset();
  });

  it("gives every saved host field and remove action a unique name", () => {
    render(<PairingHostsDisclosure />);

    fireEvent.click(screen.getByText("Manage saved pairing hosts"));

    expect(screen.getByRole("textbox", { name: "Pairing host 1" })).toHaveValue(
      "http://192.168.1.50:4173"
    );

    expect(screen.getByRole("textbox", { name: "Pairing host 2" })).toHaveValue(
      "https://deskcue.example.com"
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove pairing host 2" }));

    expect(mocks.onRemovePairingHost).toHaveBeenCalledWith(1);
  });

  it("opens the disclosure before focusing a host requested by the pairing dialog", async () => {
    const { container, rerender } = render(<PairingHostsDisclosure />);
    const disclosure = container.querySelector("details");

    expect(disclosure).not.toHaveAttribute("open");

    accessStore.pairingHostsFocusRequest = 1;
    rerender(<PairingHostsDisclosure key="requested" />);

    expect(container.querySelector("details")).toHaveAttribute("open");
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Pairing host 2" })).toHaveFocus();
    });
  });

  it("does not replay a handled focus request after unmount and remount", async () => {
    accessStore.pairingHostsFocusRequest = 1;
    const firstRender = render(<PairingHostsDisclosure />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Pairing host 2" })).toHaveFocus();
    });

    firstRender.unmount();
    const secondRender = render(<PairingHostsDisclosure />);

    expect(secondRender.container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("finishes a mount-time focus request under React StrictMode", async () => {
    accessStore.pairingHostsFocusRequest = 1;

    render(
      <StrictMode>
        <PairingHostsDisclosure />
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Pairing host 2" })).toHaveFocus();
    });

    expect(accessStore.pairingHostsHandledFocusRequest).toBe(1);
  });

  it("finishes a pending focus request when the editor becomes ready", async () => {
    accessStore.daemonSettings = null;
    accessStore.daemonSettingsDraft = null;
    accessStore.pairingHostsFocusRequest = 1;
    render(<PairingHostsDisclosure />);

    expect(screen.queryByRole("textbox", { name: "Pairing host 2" })).not.toBeInTheDocument();

    act(() => {
      accessStore.daemonSettings = daemonSettings;
      accessStore.daemonSettingsDraft = daemonSettingsDraft;
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Pairing host 2" })).toHaveFocus();
    });

    expect(accessStore.pairingHostsHandledFocusRequest).toBe(1);
  });

  it.each([
    {
      hosts: [
        "https://first.example.com",
        "https://second.example.com",
        "https://third.example.com"
      ],
      removeIndex: 0,
      targetName: "Pairing host 1",
      targetValue: "https://second.example.com"
    },
    {
      hosts: [
        "https://first.example.com",
        "https://second.example.com",
        "https://third.example.com"
      ],
      removeIndex: 1,
      targetName: "Pairing host 2",
      targetValue: "https://third.example.com"
    },
    {
      hosts: [
        "https://first.example.com",
        "https://second.example.com",
        "https://third.example.com"
      ],
      removeIndex: 2,
      targetName: "Pairing host 2",
      targetValue: "https://second.example.com"
    }
  ])("moves focus after removing host $removeIndex", async ({
    hosts,
    removeIndex,
    targetName,
    targetValue
  }) => {
    setDraftPairingHosts(hosts);

    mocks.onRemovePairingHost.mockImplementation((index: number) => {
      daemonSettingsDraft.pairingHosts.splice(index, 1);
    });

    render(<PairingHostsDisclosure />);

    fireEvent.click(screen.getByText("Manage saved pairing hosts"));
    fireEvent.click(screen.getByRole("button", { name: `Remove pairing host ${removeIndex + 1}` }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: targetName })).toHaveValue(targetValue);
      expect(screen.getByRole("textbox", { name: targetName })).toHaveFocus();
    });
  });

  it("moves focus to Add host after removing the only row", async () => {
    setDraftPairingHosts(["https://only.example.com"]);

    mocks.onRemovePairingHost.mockImplementation((index: number) => {
      daemonSettingsDraft.pairingHosts.splice(index, 1);
    });

    render(<PairingHostsDisclosure />);

    fireEvent.click(screen.getByText("Manage saved pairing hosts"));
    fireEvent.click(screen.getByRole("button", { name: "Remove pairing host 1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add host" })).toHaveFocus();
    });
  });

  it("cancels a pending removal focus frame when unmounted", () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(73);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const rendered = render(<PairingHostsDisclosure />);

    fireEvent.click(screen.getByText("Manage saved pairing hosts"));
    fireEvent.click(screen.getByRole("button", { name: "Remove pairing host 2" }));
    rendered.unmount();

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(73);
  });
});
