import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeAutoObservable } from "mobx";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  longSaveError: "Unable to save settings because the local daemon returned a detailed validation error for the configured runtime endpoint.",
  onResetDaemonSettings: vi.fn(),
  onSaveDaemonSettings: vi.fn()
}));

const systemStore = {
  daemonSettings: {},
  daemonSettingsDraft: {},
  daemonSettingsStatus: null as { kind: "error"; message: string } | null,
  onResetDaemonSettings: mocks.onResetDaemonSettings,
  onSaveDaemonSettings: mocks.onSaveDaemonSettings,
  resettingDaemonSettings: false,
  savingDaemonSettings: false,
  settingsConnectionRevision: 0,
  settingsSaveSuccessRevision: 0,
  systemSettingsDirty: false,
  get systemSettingsOperationPending() {
    return this.resettingDaemonSettings || this.savingDaemonSettings;
  }
};

makeAutoObservable(systemStore, {
  onResetDaemonSettings: false,
  onSaveDaemonSettings: false
});

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({ systemStore })
}));

vi.mock("./components/AgentDataRootsSection", () => ({
  AgentDataRootsSection: () => (
    <div>
      Agent data roots
      <button type="button">Other system control</button>
    </div>
  )
}));

vi.mock("./components/RuntimeEndpointsSection", () => ({
  RuntimeEndpointsSection: () => <div>Runtime endpoints</div>
}));

vi.mock("./components/ServiceStatusSummary", () => ({
  ServiceStatusSummary: () => <div>Service status</div>
}));

import { SystemSettingsTab } from "./SystemSettingsTab";

function renderSystemSettings() {
  return render(
    <MemoryRouter>
      <SystemSettingsTab />
    </MemoryRouter>
  );
}

describe("SystemSettingsTab save feedback", () => {
  beforeEach(() => {
    mocks.onResetDaemonSettings.mockClear();
    mocks.onSaveDaemonSettings.mockClear();
    systemStore.daemonSettingsStatus = null;
    systemStore.resettingDaemonSettings = false;
    systemStore.savingDaemonSettings = false;
    systemStore.settingsConnectionRevision = 0;
    systemStore.settingsSaveSuccessRevision = 0;
    systemStore.systemSettingsDirty = false;
  });

  it("does not mount a fixed action bar for unchanged settings", () => {
    const { container } = renderSystemSettings();

    expect(container.querySelector("[data-settings-action-bar]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to env" })).toBeInTheDocument();
  });

  it("shows Save only for a changed system draft", () => {
    systemStore.systemSettingsDirty = true;
    renderSystemSettings();

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mocks.onSaveDaemonSettings).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-settings-action-bar='full']")).toBeInTheDocument();
  });

  it("moves Save focus to the compact success confirmation", async () => {
    systemStore.systemSettingsDirty = true;
    renderSystemSettings();
    const saveButton = screen.getByRole("button", { name: "Save settings" });

    saveButton.focus();
    fireEvent.click(saveButton);

    act(() => {
      systemStore.savingDaemonSettings = true;
    });

    act(() => {
      systemStore.systemSettingsDirty = false;
      systemStore.settingsSaveSuccessRevision += 1;
    });

    expect(screen.queryByText("All system changes saved")).not.toBeInTheDocument();

    act(() => {
      systemStore.savingDaemonSettings = false;
    });

    await waitFor(() => {
      expect(screen.getByText("All system changes saved")).toHaveFocus();
      expect(document.querySelector("[data-settings-action-bar='compact']")).toBeInTheDocument();
    });
  });

  it("preserves focus that the user moved while Save was pending", async () => {
    systemStore.systemSettingsDirty = true;
    renderSystemSettings();
    const saveButton = screen.getByRole("button", { name: "Save settings" });
    const otherControl = screen.getByRole("button", { name: "Other system control" });

    saveButton.focus();
    fireEvent.click(saveButton);

    act(() => {
      systemStore.savingDaemonSettings = true;
    });

    otherControl.focus();

    act(() => {
      systemStore.systemSettingsDirty = false;
      systemStore.settingsSaveSuccessRevision += 1;
      systemStore.savingDaemonSettings = false;
    });

    await waitFor(() => {
      expect(screen.getByText("All system changes saved")).toBeInTheDocument();
      expect(otherControl).toHaveFocus();
    });
  });

  it("announces a detailed save failure as an alert", () => {
    systemStore.daemonSettingsStatus = {
      kind: "error",
      message: mocks.longSaveError
    };

    renderSystemSettings();

    expect(screen.getByRole("alert")).toHaveTextContent(mocks.longSaveError);
  });
});
