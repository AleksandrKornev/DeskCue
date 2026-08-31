import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  cancelEnrollmentAttempt: vi.fn(),
  connected: false,
  disconnect: vi.fn(),
  error: null as string | null,
  getEnrollmentAttempt: vi.fn(),
  loading: false,
  profileEnabled: false,
  refresh: vi.fn(),
  remoteControlEnabled: false,
  remoteFilesEnabled: false,
  remotePreviewEnabled: false,
  remoteReadEnabled: false,
  setStatus: vi.fn(),
  state: "connecting",
  statusEnabledOverride: null as boolean | null,
  statusStateOverride: null as string | null,
  statusAvailable: true,
  startEnrollmentAttempt: vi.fn(),
  updatePermissions: vi.fn(),
  updateSessionDisclosure: vi.fn()
}));

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

vi.mock("@assets/images/icon-cloud.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

vi.mock("@api/endpoint/cloud/endpoints", () => ({
  cloudApi: {
    connect: cloudMocks.connect,
    cancelEnrollmentAttempt: cloudMocks.cancelEnrollmentAttempt,
    disconnect: cloudMocks.disconnect,
    getEnrollmentAttempt: cloudMocks.getEnrollmentAttempt,
    startEnrollmentAttempt: cloudMocks.startEnrollmentAttempt,
    updatePermissions: cloudMocks.updatePermissions,
    updateSessionDisclosure: cloudMocks.updateSessionDisclosure
  }
}));

vi.mock("@modules/cloudConnection/model/useCloudConnectionStatus", () => ({
  useCloudConnectionStatus: () => ({
    error: cloudMocks.error,
    loading: cloudMocks.loading,
    refresh: cloudMocks.refresh,
    setStatus: cloudMocks.setStatus,
    status: cloudMocks.statusAvailable ? {
      connectorIncluded: true,
      connected: cloudMocks.connected,
      enabled: cloudMocks.statusEnabledOverride
        ?? (cloudMocks.profileEnabled || cloudMocks.connected),
      state: cloudMocks.connected
        ? "connected"
        : cloudMocks.statusStateOverride
          ?? (cloudMocks.profileEnabled ? cloudMocks.state : "disconnected"),
      cloudOrigin: cloudMocks.profileEnabled || cloudMocks.connected
        ? "https://cloud.example.test"
        : null,
      displayName: cloudMocks.profileEnabled || cloudMocks.connected ? "Review machine" : null,
      machineId: cloudMocks.profileEnabled || cloudMocks.connected ? "machine-1" : null,
      lastConnectedAt: null,
      lastErrorCode: null,
      remoteReadEnabled: cloudMocks.remoteReadEnabled,
      remoteFilesEnabled: cloudMocks.remoteFilesEnabled,
      remoteControlEnabled: cloudMocks.remoteControlEnabled,
      remotePreviewEnabled: cloudMocks.remotePreviewEnabled,
      sessionLabelDisclosureEnabled: false,
      pendingEventCount: 0
    } : null
  })
}));

import { CloudConnectionPanel } from "./CloudConnectionPanel";

function connectedStatus(overrides: Record<string, unknown> = {}) {
  return {
    connectorIncluded: true,
    connected: true,
    enabled: true,
    state: "connected",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Review machine",
    machineId: "machine-1",
    lastConnectedAt: null,
    lastErrorCode: null,
    pendingEventCount: 0,
    remoteReadEnabled: false,
    remoteFilesEnabled: false,
    remoteControlEnabled: false,
    remotePreviewEnabled: false,
    sessionLabelDisclosureEnabled: false,
    ...overrides
  };
}

describe("CloudConnectionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudMocks.connected = false;
    cloudMocks.error = null;
    cloudMocks.loading = false;
    cloudMocks.profileEnabled = false;
    cloudMocks.remoteControlEnabled = false;
    cloudMocks.remoteFilesEnabled = false;
    cloudMocks.remotePreviewEnabled = false;
    cloudMocks.remoteReadEnabled = false;
    cloudMocks.state = "connecting";
    cloudMocks.statusEnabledOverride = null;
    cloudMocks.statusStateOverride = null;
    cloudMocks.statusAvailable = true;
    cloudMocks.refresh.mockResolvedValue(undefined);
    cloudMocks.getEnrollmentAttempt.mockResolvedValue({ attempt: null });
  });

  it("shows explicit persisted-label consent for an existing Cloud connection", async () => {
    cloudMocks.connected = true;
    cloudMocks.updateSessionDisclosure.mockResolvedValue({
      ok: true,
      data: {
        connectorIncluded: true,
        connected: true,
        enabled: true,
        state: "connected",
        cloudOrigin: "https://cloud.example.test",
        displayName: "Review machine",
        machineId: "machine-1",
        lastConnectedAt: null,
        lastErrorCode: null,
        pendingEventCount: 0,
        remoteReadEnabled: false,
        remoteFilesEnabled: false,
        remoteControlEnabled: false,
        remotePreviewEnabled: false,
        sessionLabelDisclosureEnabled: true
      }
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    const disclosure = screen.getByRole("checkbox", {
      name: /Share session and workspace names/i
    });

    expect(disclosure).not.toBeChecked();
    expect(screen.getByText(/Cloud saves only short session and workspace labels/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Full paths, prompts, transcripts, and logs stay out/i))
      .toBeInTheDocument();
    fireEvent.click(disclosure);

    await waitFor(() => expect(cloudMocks.updateSessionDisclosure).toHaveBeenCalledWith({
      enabled: true
    }));
  });

  it("keeps architecture guidance collapsed for an existing connection", () => {
    cloudMocks.connected = true;

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    const summary = screen.getByText("How DeskCue Cloud connects and what stays local");
    const explainer = summary.closest("details");
    const summaryElement = summary.closest("summary");

    expect(explainer).not.toBeNull();
    expect(explainer).not.toHaveAttribute("open");
    expect(summaryElement?.querySelector("[aria-hidden=\"true\"]"))
      .toBeInTheDocument();
    expect(screen.getByText("Choose what this Cloud connection can request"))
      .toBeInTheDocument();

    fireEvent.click(summary);

    expect(explainer).toHaveAttribute("open");
  });

  it("blocks enrollment actions until Cloud status is authoritative", () => {
    cloudMocks.loading = true;
    cloudMocks.statusAvailable = false;

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByRole("status")).toHaveTextContent("Checking Cloud connection");
    expect(screen.queryByRole("button", { name: "Connect to DeskCue Cloud" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Custom or self-hosted Cloud" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Outbound-only flow")).not.toBeInTheDocument();
  });

  it("keeps trust guidance expanded before authoritative enrollment", () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByText("Outbound-only flow")).toBeInTheDocument();
    expect(screen.getByText("Local-first data boundary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect to DeskCue Cloud" }))
      .toBeEnabled();
  });

  it("retries an unavailable unknown status without exposing enrollment", () => {
    cloudMocks.error = "offline";
    cloudMocks.statusAvailable = false;

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry Cloud status" }));

    expect(cloudMocks.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Connect to DeskCue Cloud" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Outbound-only flow")).not.toBeInTheDocument();
  });

  it("hands focus from the unknown-status gate to authoritative profile controls", () => {
    cloudMocks.error = "offline";
    cloudMocks.statusAvailable = false;

    const view = render(<CloudConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    const retry = screen.getByRole("button", { name: "Retry Cloud status" });

    retry.focus();
    cloudMocks.error = null;
    cloudMocks.connected = true;
    cloudMocks.profileEnabled = true;
    cloudMocks.statusAvailable = true;
    view.rerender(<CloudConnectionPanel />);

    expect(screen.getByRole("button", { name: /Full access/i })).toHaveFocus();
  });

  it("does not reclaim status-gate focus after the user moves to the dialog chrome", () => {
    cloudMocks.error = "offline";
    cloudMocks.statusAvailable = false;

    const view = render(<CloudConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    screen.getByRole("button", { name: "Retry Cloud status" }).focus();
    screen.getByRole("button", { name: "Close dialog" }).focus();
    cloudMocks.error = null;
    cloudMocks.connected = true;
    cloudMocks.profileEnabled = true;
    cloudMocks.statusAvailable = true;
    view.rerender(<CloudConnectionPanel />);

    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
  });

  it("restores unknown-status focus to a pending enrollment link", async () => {
    cloudMocks.error = "offline";
    cloudMocks.statusAvailable = false;
    cloudMocks.getEnrollmentAttempt.mockResolvedValue({
      attempt: {
        attemptId: "attempt-1",
        cloudOrigin: "https://cloud.example.test",
        expiresAt: "2026-08-30T15:00:00.000Z",
        lastErrorCode: null,
        verificationUrl: "https://cloud.example.test/verify"
      }
    });

    const view = render(<CloudConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    await waitFor(() => expect(cloudMocks.getEnrollmentAttempt).toHaveBeenCalled());
    screen.getByRole("button", { name: "Retry Cloud status" }).focus();
    cloudMocks.error = null;
    cloudMocks.statusAvailable = true;
    view.rerender(<CloudConnectionPanel />);

    expect(await screen.findByRole("link", { name: "Continue in Cloud" })).toHaveFocus();
  });

  it("hands focus from a disconnected profile action to enrollment controls", () => {
    cloudMocks.connected = true;
    cloudMocks.profileEnabled = true;

    const view = render(<CloudConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    screen.getByRole("button", { name: "Disconnect" }).focus();
    cloudMocks.connected = false;
    cloudMocks.profileEnabled = false;
    view.rerender(<CloudConnectionPanel />);

    expect(screen.getByRole("button", { name: /Full access/i })).toHaveFocus();
  });

  it("clears pending focus ownership when the dialog closes", () => {
    cloudMocks.error = "offline";
    cloudMocks.statusAvailable = false;

    const view = render(<CloudConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    screen.getByRole("button", { name: "Retry Cloud status" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    cloudMocks.error = null;
    cloudMocks.connected = true;
    cloudMocks.profileEnabled = true;
    cloudMocks.statusAvailable = true;
    view.rerender(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByRole("button", { name: /Full access/i })).not.toHaveFocus();
  });

  it("updates all connected Cloud permissions through one explicit save", async () => {
    cloudMocks.connected = true;
    cloudMocks.updatePermissions.mockResolvedValue({
      ok: true,
      data: connectedStatus({
        remoteReadEnabled: true,
        remoteFilesEnabled: true,
        remoteControlEnabled: true,
        remotePreviewEnabled: true
      })
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByText(/Settings → Connections → DeskCue Cloud/i))
      .toBeInTheDocument();

    const remoteRead = screen.getByRole("checkbox", {
      name: /Enable Remote DeskCue session review/i
    });
    const remotePreview = screen.getByRole("checkbox", { name: /Allow remote app Preview/i });
    const remoteFiles = screen.getByRole("checkbox", {
      name: /Allow remote workspace file browsing/i
    });
    const remoteControl = screen.getByRole("checkbox", {
      name: /Allow remote prompts and stop requests/i
    });
    const save = screen.getByRole("button", { name: "Save permissions" });

    expect(save).toBeDisabled();
    expect(remotePreview).toBeEnabled();
    expect(remoteFiles).toBeEnabled();
    expect(remoteControl).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Full access/i }));
    expect(save).toBeEnabled();
    expect(remoteRead).toBeChecked();
    expect(remotePreview).toBeChecked();
    expect(remoteFiles).toBeChecked();
    expect(remoteControl).toBeChecked();
    fireEvent.click(save);

    await waitFor(() => expect(cloudMocks.updatePermissions).toHaveBeenCalledWith({
      allowRemoteControl: true,
      allowRemoteFiles: true,
      allowRemotePreview: true,
      allowRemoteRead: true
    }));
    expect(cloudMocks.setStatus).toHaveBeenCalledWith(expect.objectContaining({
      remoteReadEnabled: true,
      remoteFilesEnabled: true,
      remoteControlEnabled: true,
      remotePreviewEnabled: true
    }));
    expect(await screen.findByText("Remote permissions saved.")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("keeps independent grants when connected remote review is disabled", async () => {
    cloudMocks.connected = true;
    cloudMocks.remoteReadEnabled = true;
    cloudMocks.remoteFilesEnabled = true;
    cloudMocks.remoteControlEnabled = true;
    cloudMocks.remotePreviewEnabled = true;
    cloudMocks.updatePermissions.mockResolvedValue({
      ok: true,
      data: connectedStatus({
        remoteFilesEnabled: true,
        remoteControlEnabled: true,
        remotePreviewEnabled: true
      })
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    const remoteRead = screen.getByRole("checkbox", {
      name: /Enable Remote DeskCue session review/i
    });
    const save = screen.getByRole("button", { name: "Save permissions" });

    await waitFor(() => expect(remoteRead).toBeChecked());

    fireEvent.click(remoteRead);
    expect(save).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Allow remote app Preview/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Allow remote workspace file browsing/i }))
      .toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Allow remote prompts and stop requests/i }))
      .toBeChecked();
    fireEvent.click(remoteRead);
    expect(save).toBeDisabled();
    fireEvent.click(remoteRead);
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(cloudMocks.updatePermissions).toHaveBeenCalledWith({
      allowRemoteControl: true,
      allowRemoteFiles: true,
      allowRemotePreview: true,
      allowRemoteRead: false
    }));
  });

  it("keeps connected settings available while the saved profile reconnects", async () => {
    cloudMocks.profileEnabled = true;
    cloudMocks.remotePreviewEnabled = true;
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByText("Connecting to DeskCue Cloud")).toBeInTheDocument();
    expect(screen.getByText(/saved remote permissions resume only after/i)).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /Allow remote app Preview/i }))
      .toBeChecked();
    expect(screen.getByRole("button", { name: "Save permissions" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Connect to DeskCue Cloud" }))
      .not.toBeInTheDocument();
  });

  it("keeps revoked Cloud access distinct from a temporary reconnect", async () => {
    cloudMocks.profileEnabled = true;
    cloudMocks.remoteControlEnabled = true;
    cloudMocks.state = "revoked";
    render(<CloudConnectionPanel />);

    expect(screen.getByText("Cloud access revoked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByText("DeskCue Cloud access revoked")).toBeInTheDocument();
    expect(screen.getByText(/Cloud remote access is disabled/i)).toBeInTheDocument();
    expect(screen.getByText(/Local DeskCue remains available/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved permissions remain active/i)).not.toBeInTheDocument();
    expect(screen.getByText("Saved permissions")).toBeInTheDocument();
    expect(screen.queryByText("Enabled capabilities")).not.toBeInTheDocument();
    expect(await screen.findByRole("checkbox", {
      name: /Allow remote prompts and stop requests/i
    })).toBeChecked();
  });

  it("does not present a saved disconnected profile as local-only", () => {
    cloudMocks.profileEnabled = true;
    cloudMocks.state = "disconnected";
    render(<CloudConnectionPanel />);

    expect(screen.getByText("Cloud reconnecting")).toBeInTheDocument();
    expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  });

  it("keeps authoritative disabled state local-only despite stale connector state", () => {
    cloudMocks.statusEnabledOverride = false;
    cloudMocks.statusStateOverride = "revoked";
    render(<CloudConnectionPanel />);

    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.queryByText("Cloud access revoked")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    expect(screen.getByText("Cloud connector available")).toBeInTheDocument();
    expect(screen.queryByText("DeskCue Cloud access revoked")).not.toBeInTheDocument();
  });

  it("keeps initial Cloud status loading distinct from local-only", () => {
    cloudMocks.loading = true;
    cloudMocks.statusAvailable = false;
    render(<CloudConnectionPanel />);

    const summary = screen.getByRole("button", { name: "Open DeskCue Cloud details" });

    expect(summary).toHaveAccessibleDescription("Checking Cloud");

    expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  });

  it("keeps an unavailable Cloud status distinct from local-only", () => {
    cloudMocks.error = "Fixture Cloud status failure";
    cloudMocks.statusAvailable = false;
    render(<CloudConnectionPanel />);

    const summary = screen.getByRole("button", { name: "Open DeskCue Cloud details" });

    expect(summary).toHaveAccessibleDescription("Cloud status unavailable");

    fireEvent.click(summary);

    expect(screen.getByText("DeskCue Cloud status unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Local DeskCue remains available/i)).toBeInTheDocument();
    expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  });

  it("does not present stale connected truth after a later status refresh fails", () => {
    cloudMocks.connected = true;
    cloudMocks.error = "Fixture refresh failure";
    render(<CloudConnectionPanel />);

    const summary = screen.getByRole("button", { name: "Open DeskCue Cloud details" });

    expect(summary).toHaveAccessibleDescription("Cloud status unavailable");

    fireEvent.click(summary);

    expect(screen.getByText("DeskCue Cloud status unavailable")).toBeInTheDocument();
    expect(screen.getByText("Saved permissions")).toBeInTheDocument();
    expect(screen.queryByText("Enabled capabilities")).not.toBeInTheDocument();
  });

  it("does not expand a restricted existing profile when its settings open", async () => {
    cloudMocks.profileEnabled = true;
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    const metadataOnly = await screen.findByRole("button", { name: /Metadata only/i });

    expect(metadataOnly).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByRole("checkbox", {
      name: /Enable Remote DeskCue session review/i
    })).not.toBeChecked();
    expect(screen.getByRole("checkbox", {
      name: /Allow remote workspace file browsing/i
    })).not.toBeChecked();
    expect(screen.getByRole("checkbox", {
      name: /Allow remote prompts and stop requests/i
    })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Allow remote app Preview/i }))
      .not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save permissions" })).toBeDisabled();
    expect(cloudMocks.updatePermissions).not.toHaveBeenCalled();
  });

  it("summarizes the capabilities enabled for an existing connection", async () => {
    cloudMocks.connected = true;
    cloudMocks.remoteReadEnabled = true;
    cloudMocks.remoteFilesEnabled = true;
    cloudMocks.remoteControlEnabled = true;
    cloudMocks.remotePreviewEnabled = true;
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(await screen.findByText(
      "Session review · Workspace files · Prompts and stop · Interactive Preview"
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Full access/i }))
      .toHaveAttribute("aria-pressed", "true");
    expect(cloudMocks.updatePermissions).not.toHaveBeenCalled();
  });

  it("keeps the permissions draft retryable after a failed save", async () => {
    cloudMocks.connected = true;
    let resolveRequest: ((value: unknown) => void) | undefined;

    cloudMocks.updatePermissions.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: /Enable Remote DeskCue session review/i
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolveRequest?.({ ok: false, data: { error: "Permission update failed" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission update failed");
    expect(screen.getByRole("button", { name: "Save permissions" })).toBeEnabled();
  });

  it("defaults new enrollment to Full access and keeps manual grants independent", () => {
    render(<CloudConnectionPanel />);

    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("Optional remote access")).toBeInTheDocument();
    expect(screen.queryByText("Local daemon")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(screen.getByRole("dialog", { name: "DeskCue Cloud" })).toBeInTheDocument();
    expect(screen.getByText("Cloud connector available")).toBeInTheDocument();
    expect(screen.getByText("Local daemon")).toBeInTheDocument();
    expect(screen.getByText("Authenticated outbound channel")).toBeInTheDocument();
    expect(screen.getAllByText("DeskCue Cloud")).toHaveLength(3);
    expect(screen.getByText("Paired devices")).toBeInTheDocument();
    expect(screen.getByText(/no inbound port is required/i)).toBeInTheDocument();
    expect(screen.getByText(/not end-to-end encrypted/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Machine name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Enrollment ticket")).not.toBeInTheDocument();
    const fullAccess = screen.getByRole("button", { name: /Full access/i });
    const reviewOnly = screen.getByRole("button", { name: /Review only/i });
    const metadataOnly = screen.getByRole("button", { name: /Metadata only/i });
    const remoteRead = screen.getByRole("checkbox", {
      name: /Enable Remote DeskCue session review/i
    });
    const remoteFiles = screen.getByRole("checkbox", {
      name: /Allow remote workspace file browsing/i
    });
    const remoteControl = screen.getByRole("checkbox", {
      name: /Allow remote prompts and stop requests/i
    });
    const remotePreview = screen.getByRole("checkbox", { name: /Allow remote app Preview/i });

    expect(fullAccess).toHaveAttribute("aria-pressed", "true");

    expect(remoteRead).toBeChecked();
    expect(remoteFiles).toBeChecked();
    expect(remoteControl).toBeChecked();
    expect(remotePreview).toBeChecked();
    expect(screen.getByText(/cannot grant itself more access/i)).toBeInTheDocument();
    expect(screen.getByText(/Settings → Connections → DeskCue Cloud/i)).toBeInTheDocument();

    fireEvent.click(remotePreview);
    expect(screen.getByText("Custom permissions selected.")).toBeInTheDocument();
    expect(fullAccess).toHaveAttribute("aria-pressed", "false");
    expect(reviewOnly).toHaveAttribute("aria-pressed", "false");
    expect(metadataOnly).toHaveAttribute("aria-pressed", "false");
    expect(remoteRead).toBeChecked();
    expect(remoteFiles).toBeChecked();
    expect(remoteControl).toBeChecked();
    expect(remotePreview).not.toBeChecked();

    fireEvent.click(reviewOnly);
    expect(reviewOnly).toHaveAttribute("aria-pressed", "true");
    expect(remoteRead).toBeChecked();
    expect(remoteFiles).toBeChecked();
    expect(remoteControl).not.toBeChecked();
    expect(remotePreview).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Connect to DeskCue Cloud" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Custom or self-hosted Cloud" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(screen.queryByRole("dialog", { name: "DeskCue Cloud" })).not.toBeInTheDocument();
  });

  it("sends an explicitly selected enrollment preset to a custom Cloud", async () => {
    cloudMocks.connect.mockResolvedValue({
      ok: true,
      data: {
        connectorIncluded: true,
        connected: false,
        enabled: true,
        state: "connecting",
        cloudOrigin: "https://cloud.example.com",
        displayName: "Review machine",
        machineId: "machine-1",
        lastConnectedAt: null,
        lastErrorCode: null,
        pendingEventCount: 0,
        remoteReadEnabled: true,
        remoteFilesEnabled: true,
        remoteControlEnabled: true
      }
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("button", { name: /Review only/i }));
    fireEvent.click(screen.getByRole("button", { name: "Custom or self-hosted Cloud" }));
    fireEvent.change(screen.getByLabelText("Cloud origin"), {
      target: { value: "https://cloud.example.com" }
    });
    fireEvent.change(screen.getByLabelText("Machine name"), {
      target: { value: "Review machine" }
    });
    fireEvent.change(screen.getByLabelText("Enrollment ticket"), {
      target: { value: "ticket-placeholder" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect custom Cloud" }));

    await waitFor(() => expect(cloudMocks.connect).toHaveBeenCalledWith({
      allowRemoteControl: false,
      allowRemoteFiles: true,
      allowRemotePreview: false,
      allowRemoteRead: true,
      cloudOrigin: "https://cloud.example.com",
      displayName: "Review machine",
      enrollmentTicket: "ticket-placeholder"
    }));
  });

  it("starts official browser enrollment without exposing or copying a ticket", async () => {
    const popup = {
      close: vi.fn(),
      location: { href: "about:blank" },
      opener: window
    };

    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    cloudMocks.startEnrollmentAttempt.mockResolvedValue({
      ok: true,
      data: {
        attempt: {
          attemptId: "attempt-1",
          cloudOrigin: "https://app.deskcue.io",
          displayName: "DeskCue machine",
          verificationUrl: "https://app.deskcue.io/enroll/attempt-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          pollIntervalMs: 2_000,
          status: "pending",
          lastErrorCode: null
        }
      }
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect to DeskCue Cloud" }));

    await waitFor(() => expect(cloudMocks.startEnrollmentAttempt).toHaveBeenCalledWith({
      allowRemoteControl: true,
      allowRemoteFiles: true,
      allowRemotePreview: true,
      allowRemoteRead: true,
      cloudOrigin: "https://app.deskcue.io",
      displayName: "DeskCue machine"
    }));
    expect(popup.location.href).toBe("https://app.deskcue.io/enroll/attempt-1");
    expect(screen.queryByLabelText("Enrollment ticket")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByLabelText("Machine name")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not present editable settings for a restored enrollment attempt", async () => {
    cloudMocks.getEnrollmentAttempt.mockResolvedValue({
      attempt: {
        attemptId: "attempt-restored",
        cloudOrigin: "https://app.deskcue.io",
        displayName: "Stored machine name",
        verificationUrl: "https://app.deskcue.io/enroll/attempt-restored",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollIntervalMs: 1_000,
        status: "pending",
        lastErrorCode: null
      }
    });

    cloudMocks.cancelEnrollmentAttempt.mockResolvedValue({ ok: true, data: { attempt: null } });
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));

    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByLabelText("Machine name")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Full access/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByLabelText("Machine name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Full access/i })).toBeInTheDocument();
  });

  it("does not infer remote control consent from remote review", async () => {
    cloudMocks.connect.mockResolvedValue({
      ok: false,
      data: { error: "fixture" }
    });

    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("button", { name: /Metadata only/i }));
    fireEvent.click(screen.getByRole("button", { name: "Custom or self-hosted Cloud" }));
    fireEvent.change(screen.getByLabelText("Cloud origin"), {
      target: { value: "https://cloud.example.com" }
    });
    fireEvent.change(screen.getByLabelText("Enrollment ticket"), {
      target: { value: "ticket-placeholder" }
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Enable Remote DeskCue session review/i }));
    fireEvent.click(screen.getByRole("button", { name: "Connect custom Cloud" }));

    await waitFor(() => expect(cloudMocks.connect).toHaveBeenCalledWith(expect.objectContaining({
      allowRemoteControl: false,
      allowRemoteFiles: false,
      allowRemoteRead: true
    })));
  });

  it("does not infer workspace file consent from remote session review", async () => {
    cloudMocks.connect.mockResolvedValue({ ok: false, data: { error: "fixture" } });
    render(<CloudConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open DeskCue Cloud details" }));
    fireEvent.click(screen.getByRole("button", { name: /Metadata only/i }));
    fireEvent.click(screen.getByRole("button", { name: "Custom or self-hosted Cloud" }));
    fireEvent.change(screen.getByLabelText("Cloud origin"), {
      target: { value: "https://cloud.example.com" }
    });
    fireEvent.change(screen.getByLabelText("Enrollment ticket"), {
      target: { value: "ticket-placeholder" }
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Enable Remote DeskCue session review/i }));
    fireEvent.click(screen.getByRole("button", { name: "Connect custom Cloud" }));

    await waitFor(() => expect(cloudMocks.connect).toHaveBeenCalledWith(expect.objectContaining({
      allowRemoteFiles: false,
      allowRemoteRead: true
    })));
  });
});
