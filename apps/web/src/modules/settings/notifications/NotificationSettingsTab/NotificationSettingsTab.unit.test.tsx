import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeAutoObservable } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  setEnabled: vi.fn(),
  toggleRoute: vi.fn()
}));

const notificationStore = {
  draft: {
    enabled: true,
    routes: {
      "session.approval_requested": ["web_push"]
    }
  },
  eventOptions: [
    {
      description: "An agent is waiting for approve/reject",
      event: "session.approval_requested",
      label: "Approval needed"
    }
  ],
  load: mocks.load,
  loadingNotificationSettings: false,
  connectionRevision: 0,
  notificationSettingsDirty: true,
  notificationSettingsSaveSuccessRevision: 0,
  telegramPairing: null as { code: string } | null,
  get notificationSettingsOperationPending() {
    return this.savingNotificationSettings || this.resolvingTelegramPairing;
  },
  get notificationSettingsOperationStatus() {
    if (this.savingNotificationSettings) return "Saving notification settings";
    if (this.resolvingTelegramPairing) return "Finding Telegram chat and saving notification settings";

    return "";
  },
  providerOptions: [
    {
      label: "Web Push",
      provider: "web_push"
    },
    {
      label: "Telegram",
      provider: "telegram"
    }
  ],
  saveNotificationSettings: vi.fn(),
  resolvingTelegramPairing: false,
  savingNotificationSettings: false,
  setEnabled: mocks.setEnabled,
  toggleRoute: mocks.toggleRoute
};

makeAutoObservable(notificationStore);

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({ notificationStore })
}));

vi.mock("./components/NotificationDeliveryDiagnosticsPanel/NotificationDeliveryDiagnosticsPanel", () => ({
  NotificationDeliveryDiagnosticsPanel: () => <div>Delivery diagnostics</div>
}));

vi.mock("./components/NotificationProviderSettingsGrid", () => ({
  NotificationProviderSettingsGrid: () => (
    <div>
      Provider settings
      <button type="button">Send test Web Push</button>
      <button
        disabled={!notificationStore.telegramPairing || notificationStore.resolvingTelegramPairing}
        type="button"
      >
        {notificationStore.resolvingTelegramPairing ? "Finding..." : "Find chat"}
      </button>
      <details>
        <summary>What does DeskCue need?</summary>
        Browser capability details
      </details>
    </div>
  )
}));

import { NotificationSettingsTab } from "./NotificationSettingsTab";

describe("NotificationSettingsTab accessibility", () => {
  beforeEach(() => {
    mocks.load.mockClear();
    mocks.setEnabled.mockClear();
    mocks.toggleRoute.mockClear();
    notificationStore.savingNotificationSettings = false;
    notificationStore.resolvingTelegramPairing = false;
    notificationStore.notificationSettingsDirty = true;
    notificationStore.notificationSettingsSaveSuccessRevision = 0;
    notificationStore.connectionRevision = 0;
    notificationStore.telegramPairing = null;
  });

  it("labels the global notification control with its visible copy", () => {
    render(<NotificationSettingsTab />);

    const enabledToggle = screen.getByRole("checkbox", { name: "Enable notifications" });

    fireEvent.click(enabledToggle);

    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
  });

  it("includes the event name in every route control", () => {
    render(<NotificationSettingsTab />);

    expect(screen.getByRole("group", { name: /Approval needed/ })).toBeInTheDocument();

    const telegramRoute = screen.getByRole("checkbox", {
      name: "Approval needed: Telegram"
    });

    fireEvent.click(telegramRoute);

    expect(mocks.toggleRoute).toHaveBeenCalledWith(
      "session.approval_requested",
      "telegram",
      true
    );
  });

  it("prevents edits while a save request owns the draft", () => {
    notificationStore.savingNotificationSettings = true;

    render(<NotificationSettingsTab />);

    expect(screen.getByRole("group", { name: "Notification settings controls" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    const form = screen.getByRole("tabpanel").querySelector("form");
    const status = screen.getByText("Saving notification settings");

    expect(form).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(form).not.toContainElement(status);
  });

  it("blocks save throughout Telegram resolution and announces the owned operation", () => {
    notificationStore.resolvingTelegramPairing = true;

    render(<NotificationSettingsTab />);

    expect(screen.getByRole("group", { name: "Notification settings controls" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save notifications" })).toBeDisabled();
    expect(screen.getByText("Finding Telegram chat and saving notification settings")).toHaveAttribute(
      "aria-live",
      "polite"
    );
  });

  it("replaces the completed Save action with a focused clean status", async () => {
    notificationStore.savingNotificationSettings = true;
    render(<NotificationSettingsTab />);

    act(() => {
      notificationStore.savingNotificationSettings = false;
      notificationStore.notificationSettingsDirty = false;
      notificationStore.notificationSettingsSaveSuccessRevision += 1;
    });

    await waitFor(() => {
      expect(screen.getByText("All notification changes saved")).toHaveFocus();
    });

    expect(screen.queryByRole("button", { name: "Save notifications" })).not.toBeInTheDocument();
  });

  it("does not offer a no-op Save before the draft changes", () => {
    notificationStore.notificationSettingsDirty = false;

    render(<NotificationSettingsTab />);

    expect(screen.queryByText("All notification changes saved")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save notifications" })).not.toBeInTheDocument();
  });

  it("dismisses the saved confirmation when the draft changes again", async () => {
    notificationStore.savingNotificationSettings = true;
    notificationStore.notificationSettingsDirty = true;
    render(<NotificationSettingsTab />);

    act(() => {
      notificationStore.savingNotificationSettings = false;
      notificationStore.notificationSettingsDirty = false;
      notificationStore.notificationSettingsSaveSuccessRevision += 1;
    });

    expect(await screen.findByText("All notification changes saved")).toBeInTheDocument();

    act(() => {
      notificationStore.notificationSettingsDirty = true;
    });

    await waitFor(() => {
      expect(screen.queryByText("All notification changes saved")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save notifications" })).toBeInTheDocument();
  });

  it("recovers focus after a failed save is retried successfully", async () => {
    notificationStore.savingNotificationSettings = true;
    notificationStore.notificationSettingsDirty = true;
    render(<NotificationSettingsTab />);

    act(() => {
      notificationStore.savingNotificationSettings = false;
    });

    expect(screen.queryByText("All notification changes saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save notifications" })).toHaveFocus();

    act(() => {
      notificationStore.savingNotificationSettings = true;
    });
    act(() => {
      notificationStore.savingNotificationSettings = false;
      notificationStore.notificationSettingsDirty = false;
      notificationStore.notificationSettingsSaveSuccessRevision += 1;
    });

    await waitFor(() => {
      expect(screen.getByText("All notification changes saved")).toHaveFocus();
    });
  });

  it("does not carry a pending save confirmation across a connection reset", async () => {
    notificationStore.savingNotificationSettings = true;
    notificationStore.notificationSettingsDirty = true;
    render(<NotificationSettingsTab />);

    act(() => {
      notificationStore.connectionRevision += 1;
      notificationStore.savingNotificationSettings = false;
      notificationStore.notificationSettingsDirty = false;
    });

    await waitFor(() => {
      expect(screen.queryByText("All notification changes saved")).not.toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Save notifications" })).not.toBeInTheDocument();
  });

  it("restores focus to the originating provider action after its operation", async () => {
    render(<NotificationSettingsTab />);
    const providerAction = screen.getByRole("button", { name: "Send test Web Push" });

    providerAction.focus();
    fireEvent.click(providerAction);

    act(() => {
      notificationStore.resolvingTelegramPairing = true;
    });
    act(() => {
      notificationStore.resolvingTelegramPairing = false;
    });

    await waitFor(() => {
      expect(providerAction).toHaveFocus();
    });
  });

  it("does not steal focus back when the user moved outside the pending form", async () => {
    render(<NotificationSettingsTab />);
    const providerAction = screen.getByRole("button", { name: "Send test Web Push" });
    const externalAction = document.createElement("button");

    externalAction.textContent = "Outside action";
    document.body.append(externalAction);
    providerAction.focus();
    fireEvent.click(providerAction);

    act(() => {
      notificationStore.resolvingTelegramPairing = true;
    });

    externalAction.focus();

    act(() => {
      notificationStore.resolvingTelegramPairing = false;
    });

    await waitFor(() => {
      expect(externalAction).toHaveFocus();
    });

    externalAction.remove();
  });

  it("preserves intentional focus on an interactive form descendant", async () => {
    render(<NotificationSettingsTab />);
    const providerAction = screen.getByRole("button", { name: "Send test Web Push" });
    const requirementSummary = screen.getByText("What does DeskCue need?");

    providerAction.focus();
    fireEvent.click(providerAction);

    act(() => {
      notificationStore.resolvingTelegramPairing = true;
    });

    requirementSummary.focus();
    fireEvent.click(requirementSummary);

    act(() => {
      notificationStore.resolvingTelegramPairing = false;
    });

    await waitFor(() => {
      expect(requirementSummary).toHaveFocus();
    });
  });

  it("moves focus from a disabled Telegram action to the auto-save confirmation", async () => {
    notificationStore.telegramPairing = { code: "pair-code" };
    render(<NotificationSettingsTab />);
    const findChat = screen.getByRole("button", { name: "Find chat" });

    findChat.focus();
    fireEvent.click(findChat);

    act(() => {
      notificationStore.resolvingTelegramPairing = true;
    });

    act(() => {
      notificationStore.telegramPairing = null;
      notificationStore.resolvingTelegramPairing = false;
      notificationStore.notificationSettingsDirty = false;
      notificationStore.notificationSettingsSaveSuccessRevision += 1;
    });

    await waitFor(() => {
      expect(screen.getByText("All notification changes saved")).toHaveFocus();
    });
  });
});
