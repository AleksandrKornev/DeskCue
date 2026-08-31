import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makeAutoObservable } from "mobx";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadStorageStats: vi.fn(),
  openCustomStorageLimitDialog: vi.fn(),
  refreshStorageStats: vi.fn(),
  setStorageBudgetFromPreset: vi.fn()
}));

const storageStore = {
  clearingMigrationBackups: false,
  compactStorage: vi.fn(),
  compactingStorage: false,
  connectionRevision: 0,
  clearMigrationBackups: vi.fn(),
  daemonSettings: {
    sources: {
      storageMaxMb: { source: "web" }
    },
    storageMaxMb: 50
  },
  loadStorageStats: mocks.loadStorageStats,
  loadingStorageStats: false,
  openCustomStorageLimitDialog: mocks.openCustomStorageLimitDialog,
  refreshStorageStats: mocks.refreshStorageStats,
  savingStorageBudget: false,
  settingsMutationPending: false,
  setStorageBudgetFromPreset: mocks.setStorageBudgetFromPreset,
  storageStats: {
    database: {
      bytes: 9_723_904,
      logBytes: 18_990_357,
      path: "C:\\deskcue\\deskcue.sqlite",
      serviceUsageBytes: 36_718_903,
      storageLimitBytes: 52_428_800,
      walBytes: 4_185_952
    },
    localChats: {
      bytes: 518_392,
      chatCount: 30,
      path: "C:\\deskcue\\chats"
    },
    migrationBackups: {
      bytes: 0,
      count: 0
    },
    sessions: {
      inactiveAttachedJsonBytes: 90_079,
      inactiveManagedJsonBytes: 3_088_081,
      total: 36
    },
    warnings: []
  }
};

makeAutoObservable(storageStore, {
  clearMigrationBackups: false,
  compactStorage: false,
  loadStorageStats: false,
  openCustomStorageLimitDialog: false,
  refreshStorageStats: false,
  setStorageBudgetFromPreset: false
});

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({ storageStore })
}));

vi.mock("@modules/settings/shared/SettingSourceDetails", () => ({
  SettingSourceDetails: () => <div>Storage source</div>
}));

import { StorageSettingsTab } from "./StorageSettingsTab";

function renderStorageSettings() {
  return render(
    <MemoryRouter>
      <StorageSettingsTab />
    </MemoryRouter>
  );
}

describe("StorageSettingsTab mobile hierarchy", () => {
  beforeEach(() => {
    mocks.loadStorageStats.mockClear();
    mocks.openCustomStorageLimitDialog.mockClear();
    mocks.refreshStorageStats.mockClear();
    mocks.setStorageBudgetFromPreset.mockClear();
    storageStore.compactStorage.mockReset();
    storageStore.compactStorage.mockResolvedValue(false);
    storageStore.connectionRevision = 0;
    storageStore.storageStats.migrationBackups.bytes = 0;
    storageStore.storageStats.migrationBackups.count = 0;
  });

  it("exposes the selected budget as a grouped pressed state", () => {
    renderStorageSettings();
    const budgetGroup = screen.getByRole("group", { name: "Service storage budget" });

    expect(within(budgetGroup).getByRole("button", { name: "20 MiB" })).toHaveAttribute("aria-pressed", "false");
    expect(within(budgetGroup).getByRole("button", { name: "50 MiB" })).toHaveAttribute("aria-pressed", "true");
    expect(within(budgetGroup).getByRole("button", { name: "100 MiB" })).toHaveAttribute("aria-pressed", "false");
    expect(within(budgetGroup).getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps destructive cleanup inside the maintenance disclosure", () => {
    renderStorageSettings();
    const maintenanceSummary = screen.getByText("Maintenance & paths");
    const maintenanceDisclosure = maintenanceSummary.closest("details");
    const cleanupButton = screen.getByRole("button", { name: "Clear service storage" });

    expect(maintenanceDisclosure).not.toHaveAttribute("open");
    expect(maintenanceDisclosure).toContainElement(cleanupButton);

    fireEvent.click(maintenanceSummary);

    expect(maintenanceDisclosure).toHaveAttribute("open");
    expect(cleanupButton).toBeInTheDocument();
  });

  it("keeps a failed cleanup confirmation open for retry", async () => {
    renderStorageSettings();

    fireEvent.click(screen.getByText("Maintenance & paths"));
    fireEvent.click(screen.getByRole("button", { name: "Clear service storage" }));

    const confirmation = screen.getByRole("dialog", { name: "Clear service storage?" });

    fireEvent.click(within(confirmation).getByRole("button", { name: "Clear service storage" }));

    await waitFor(() => {
      expect(storageStore.compactStorage).toHaveBeenCalledOnce();
      expect(screen.getByRole("dialog", { name: "Clear service storage?" })).toBeInTheDocument();
    });
  });

  it("closes a destructive confirmation when the connection epoch changes", async () => {
    renderStorageSettings();

    fireEvent.click(screen.getByText("Maintenance & paths"));
    fireEvent.click(screen.getByRole("button", { name: "Clear service storage" }));

    expect(screen.getByRole("dialog", { name: "Clear service storage?" })).toBeInTheDocument();

    act(() => {
      storageStore.connectionRevision += 1;
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Clear service storage?" })).not.toBeInTheDocument();
    });
  });

  it("blocks a stale confirmation synchronously before sending to a new connection", () => {
    renderStorageSettings();

    fireEvent.click(screen.getByText("Maintenance & paths"));
    fireEvent.click(screen.getByRole("button", { name: "Clear service storage" }));

    const staleConfirmButton = within(
      screen.getByRole("dialog", { name: "Clear service storage?" })
    ).getByRole("button", { name: "Clear service storage" });

    act(() => {
      storageStore.connectionRevision += 1;
      staleConfirmButton.click();
    });

    expect(storageStore.compactStorage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Clear service storage?" })).not.toBeInTheDocument();
  });

  it("does not let a late cleanup completion close a newer confirmation", async () => {
    let resolveCleanup!: (succeeded: boolean) => void;
    const pendingCleanup = new Promise<boolean>((resolve) => {
      resolveCleanup = resolve;
    });

    storageStore.storageStats.migrationBackups.bytes = 1024;
    storageStore.storageStats.migrationBackups.count = 1;
    storageStore.compactStorage.mockReturnValue(pendingCleanup);
    renderStorageSettings();

    fireEvent.click(screen.getByText("Maintenance & paths"));
    fireEvent.click(screen.getByRole("button", { name: "Clear service storage" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Clear service storage?" }))
        .getByRole("button", { name: "Clear service storage" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel confirmation" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete copies" }));

    expect(screen.getByRole("dialog", { name: "Delete recovery copies?" })).toBeInTheDocument();

    await act(async () => {
      resolveCleanup(true);
      await pendingCleanup;
    });

    expect(screen.getByRole("dialog", { name: "Delete recovery copies?" })).toBeInTheDocument();
  });
});
