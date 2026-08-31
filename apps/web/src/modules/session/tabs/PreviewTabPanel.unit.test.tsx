import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreviewTabPanel } from "./PreviewTabPanel";
import type { PreviewTabPanelProps } from "./types";

function renderPanel(overrides: Partial<PreviewTabPanelProps> = {}) {
  const props: PreviewTabPanelProps = {
    configuredPreviewNetworkMode: "device-direct",
    configuredPreviewPort: null,
    hasSelectedSession: true,
    previewCandidates: [],
    previewCandidatesError: "",
    previewCandidatesLoading: false,
    previewDocumentRevision: 0,
    previewError: "",
    previewLoading: false,
    previewPort: "",
    previewReloadVersion: 0,
    previewUrl: null,
    onChangePreviewPort: vi.fn(),
    onChangePreviewNetworkMode: vi.fn(),
    onReloadPreview: vi.fn(),
    onRetryPreview: vi.fn(),
    onSetPreview: vi.fn(),
    onStopPreview: vi.fn(),
    ...overrides
  };

  return { ...render(<PreviewTabPanel {...props} />), props };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe("PreviewTabPanel", () => {
  const stablePreviewUrl = "/api/preview/sessions/session-1/";

  it("keeps an inactive backend preview empty and hides frame controls", () => {
    renderPanel();

    expect(screen.getByRole("textbox", { name: "Preview port" })).toHaveValue("");
    expect(screen.getByPlaceholderText("5173")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Preview is off" })).toHaveTextContent("Off");
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });

  it("enables preview setup after a port is entered", () => {
    renderPanel({ previewPort: "5173" });

    expect(screen.getByRole("button", { name: "Open preview" })).toBeEnabled();
  });

  it("associates invalid port guidance with the field and blocks submit", () => {
    const { props } = renderPanel({ previewPort: "Infinity" });

    const portInput = screen.getByRole("textbox", { name: "Preview port" });
    const portError = screen.getByRole("alert");

    expect(portInput).toHaveAttribute("aria-invalid", "true");
    expect(portInput).toHaveAttribute("aria-describedby", portError.id);
    expect(portError).toHaveTextContent(
      "Preview port must be an integer between 1 and 65535"
    );

    expect(screen.getByRole("button", { name: "Open preview" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Through DeskCue host/u }));

    expect(props.onChangePreviewNetworkMode).toHaveBeenCalledWith("deskcue-host");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("makes the detected-app selection step explicit", () => {
    const { rerender, props } = renderPanel({
      previewCandidates: [{ configured: false, port: 5173 }]
    });

    expect(screen.getByText("Select detected app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeDisabled();

    rerender(<PreviewTabPanel {...props} previewPort="5173" />);

    expect(screen.getByText("Selected app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeEnabled();
  });

  it("places the required app selection before optional request routing", () => {
    renderPanel({
      previewCandidates: [{ configured: false, port: 5173 }]
    });

    const detectedApp = screen.getByRole("button", { name: "Local app on port 5173" });
    const requestRouting = screen.getByRole("group", { name: "External requests" });

    expect(detectedApp.compareDocumentPosition(requestRouting))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows native review controls and the sandboxed proxy frame for an active preview", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    expect(screen.queryByRole("button", { name: "Use desktop viewport" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use mobile viewport" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByTitle("DeskCue preview")).toHaveAttribute(
      "sandbox",
      "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
    );

    expect(screen.queryByRole("textbox", { name: "Preview port" })).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-frame-loading")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Loading · port 5173" })).toBeInTheDocument();
    fireEvent.load(screen.getByTitle("DeskCue preview"));
    expect(screen.queryByTestId("preview-frame-loading")).not.toBeInTheDocument();
  });

  it("warns about HTTPS-only APIs without marking an HTTP network preview unavailable", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: "http://192.0.2.10:4101/api/preview/sessions/session-1/"
    });

    const frame = screen.getByTitle("DeskCue preview");

    fireEvent.load(frame);

    expect(screen.getByRole("note", { name: "Limited browser features" })).toHaveTextContent(
      "Web Crypto, Service Workers, camera access, and WebAuthn may be unavailable"
    );

    expect(screen.getByRole("status", { name: "Loaded · port 5173" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(frame).toBeInTheDocument();
  });

  it("keeps an intentionally blank loaded preview available without claiming it is live", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    fireEvent.load(screen.getByTitle("DeskCue preview"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loaded · port 5173" })).toBeInTheDocument();
  });

  it.each([
    "https://preview.example.test/api/preview/sessions/session-1/",
    "http://localhost:4101/api/preview/sessions/session-1/",
    "http://preview.localhost:4101/api/preview/sessions/session-1/",
    "http://127.42.0.1:4101/api/preview/sessions/session-1/",
    "http://[::1]:4101/api/preview/sessions/session-1/"
  ])("does not show an insecure-origin warning for trusted Preview URL %s", (previewUrl) => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl
    });

    expect(screen.queryByRole("note", { name: "Limited browser features" }))
      .not.toBeInTheDocument();
  });

  it("delegates an active Cloud preview to the host without rendering a localhost frame", () => {
    const onLaunchPreview = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      configuredPreviewPort: 5173,
      onLaunchPreview,
      previewPort: "5173"
    });

    expect(screen.queryByTitle("DeskCue preview")).not.toBeInTheDocument();
    expect(screen.getByText(/never connects directly/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Cloud Preview" }));

    expect(onLaunchPreview).toHaveBeenCalledTimes(1);
  });

  it("gives Cloud connection settings their own layout row while they are open", () => {
    const { container } = renderPanel({
      configuredPreviewPort: 5173,
      onLaunchPreview: vi.fn().mockResolvedValue(undefined),
      previewPort: "5173"
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview connection" }));

    expect(container.firstElementChild?.className).toContain("previewReviewConnectionOpen");
    expect(screen.getByRole("button", { name: "Switch preview" })).toBeEnabled();
  });

  it("keeps connection changes secondary after preview is running", () => {
    const { container } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    const connectionButton = screen.getByRole("button", { name: "Preview connection" });

    fireEvent.click(connectionButton);

    expect(connectionButton).toHaveAttribute("aria-expanded", "true");
    expect(connectionButton.className).toContain("previewToolbarButtonActive");
    expect(container.firstElementChild?.className).toContain("previewReviewConnectionOpen");
    expect(screen.getByRole("textbox", { name: "Preview port" })).toHaveValue("5173");
    expect(screen.getByRole("button", { name: "Switch preview" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /From this device/ })).toBeChecked();
  });

  it("keeps one connection form when an open preview enters recovery", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview connection" }));
    const toolbarPortInput = screen.getByRole("textbox", { name: "Preview port" });

    toolbarPortInput.focus();

    expect(toolbarPortInput).toHaveFocus();
    expect(screen.getAllByRole("textbox", { name: "Preview port" })).toHaveLength(1);

    rerender(
      <PreviewTabPanel
        {...props}
        previewError="The local preview server is unavailable."
        previewPort="Infinity"
      />
    );

    const connectionButton = screen.getByRole("button", { name: "Preview connection" });
    const portInput = screen.getByRole("textbox", { name: "Preview port" });

    expect(connectionButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("textbox", { name: "Preview port" })).toHaveLength(1);
    expect(portInput).toHaveFocus();

    fireEvent.click(connectionButton);

    expect(portInput).toHaveFocus();
    expect(screen.getAllByRole("textbox", { name: "Preview port" })).toHaveLength(1);

    const alerts = screen.getAllByRole("alert");
    const validationAlerts = alerts.filter((alert) => alert.textContent?.includes(
      "Preview port must be an integer between 1 and 65535"
    ));

    expect(alerts).toHaveLength(2);
    expect(validationAlerts).toHaveLength(1);
  });

  it("keeps submit focus ownership until an asynchronous recovery state renders", async () => {
    const configureRequest = deferred<void>();
    const onSetPreview = vi.fn(() => configureRequest.promise);
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5174,
      onSetPreview,
      previewPort: "5174",
      previewUrl: stablePreviewUrl
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview connection" }));

    const toolbarPortInput = screen.getByRole("textbox", { name: "Preview port" });

    toolbarPortInput.focus();
    fireEvent.submit(toolbarPortInput.closest("form")!);

    expect(onSetPreview).toHaveBeenCalledTimes(1);
    expect(toolbarPortInput).toHaveFocus();

    await act(async () => {
      configureRequest.resolve();
      await configureRequest.promise;
    });

    expect(screen.queryByRole("textbox", { name: "Preview port" })).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();

    rerender(
      <PreviewTabPanel
        {...props}
        previewError="The local preview server is unavailable."
      />
    );

    expect(screen.getByRole("textbox", { name: "Preview port" })).toHaveFocus();
  });

  it("focuses the visible manual-port summary when recovery has detected candidates", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewCandidates: [{ configured: false, port: 4173 }],
      previewError: "The local preview server is unavailable.",
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    const manualPortSummary = screen.getByText("Use another port");

    expect(manualPortSummary.closest("details")).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "Preview connection" }));

    expect(manualPortSummary).toHaveFocus();
    expect(screen.getAllByRole("textbox", { name: "Preview port", hidden: true })).toHaveLength(1);
  });

  it("stops DeskCue preview without presenting the action as stopping the local app", async () => {
    let finishStop!: (value: boolean) => void;
    const onStopPreview = vi.fn(() => new Promise<boolean>((resolve) => {
      finishStop = resolve;
    }));

    renderPanel({
      configuredPreviewPort: 5173,
      onStopPreview,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    const stopButton = screen.getByRole("button", { name: "Stop preview" });
    const previewStatus = screen.getByRole("status", { name: "Loading · port 5173" });

    expect(previewStatus.parentElement).toContainElement(stopButton);

    expect(stopButton).toHaveAttribute(
      "title",
      "Stop DeskCue preview without stopping the local app"
    );

    fireEvent.click(stopButton);

    expect(onStopPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stopping preview" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview connection" })).toBeDisabled();
    expect(stopButton).toHaveTextContent("Stopping…");
    expect(screen.getByRole("status", { name: "Stopping preview · port 5173" }))
      .toHaveTextContent("Stopping");

    await act(async () => {
      finishStop(true);
      await Promise.resolve();
    });

    expect(stopButton).toBeEnabled();
    expect(stopButton).toHaveTextContent("Stop");
  });

  it.each([
    ["false", () => false],
    ["a synchronous exception", () => {
      throw new Error("stop failed");
    }],
    ["a rejected promise", () => Promise.reject(new Error("stop failed"))]
  ])("recovers when Stop returns %s", async (_label, onStopPreview) => {
    renderPanel({
      configuredPreviewPort: 5173,
      onStopPreview,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Stop preview" })).toBeEnabled();
    expect(screen.getByRole("status", { name: "Could not stop preview" }))
      .toHaveTextContent("Stop failed");
  });

  it("does not leak a late Stop failure into another selected session", async () => {
    let finishStop!: (value: boolean) => void;
    const onStopPreview = vi.fn(() => new Promise<boolean>((resolve) => {
      finishStop = resolve;
    }));
    const props: PreviewTabPanelProps = {
      configuredPreviewNetworkMode: "device-direct",
      configuredPreviewPort: 5173,
      hasSelectedSession: true,
      previewCandidates: [],
      previewCandidatesError: "",
      previewCandidatesLoading: false,
      previewDocumentRevision: 0,
      previewError: "",
      previewLoading: false,
      previewPort: "5173",
      previewReloadVersion: 0,
      previewUrl: null,
      onChangePreviewPort: vi.fn(),
      onChangePreviewNetworkMode: vi.fn(),
      onReloadPreview: vi.fn(),
      onRetryPreview: vi.fn(),
      onSetPreview: vi.fn(),
      onStopPreview
    };

    const { rerender } = render(<PreviewTabPanel key="session-a" {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));

    rerender(<PreviewTabPanel key="session-b" {...props} />);

    await act(async () => {
      finishStop(false);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Stop preview" })).toBeEnabled();
    expect(screen.getByRole("status", { name: "Configured on port 5173" }))
      .toHaveTextContent(":5173");
    expect(screen.queryByRole("status", { name: "Could not stop preview" }))
      .not.toBeInTheDocument();
  });

  it("announces an asynchronous preview discovery error", () => {
    renderPanel({ previewCandidatesError: "Could not scan local ports" });

    expect(screen.getByText("Could not scan local ports")).toHaveAttribute("role", "status");
  });

  it("offers the two explicit external-request routing modes", () => {
    const onChangePreviewNetworkMode = vi.fn();

    renderPanel({ onChangePreviewNetworkMode });

    fireEvent.click(screen.getByRole("radio", { name: /Through DeskCue host/ }));

    expect(onChangePreviewNetworkMode).toHaveBeenCalledWith("deskcue-host");
    expect(screen.getByText("External requests use the host computer and its VPN.")).toBeInTheDocument();
  });

  it("does not remount a live frame when only its short-lived ticket rotates", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const frame = screen.getByTitle("DeskCue preview");

    fireEvent.load(frame);

    rerender(
      <PreviewTabPanel
        {...props}
        previewUrl={stablePreviewUrl}
      />
    );

    expect(screen.getByTitle("DeskCue preview")).toBe(frame);
    expect(frame).toHaveAttribute("src", stablePreviewUrl);
    expect(screen.queryByTestId("preview-frame-loading")).not.toBeInTheDocument();
  });

  it("remounts once when a new daemon credential generation is resolved", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const frame = screen.getByTitle("DeskCue preview");

    fireEvent.load(frame);

    rerender(
      <PreviewTabPanel
        {...props}
        previewDocumentRevision={1}
      />
    );

    const reloadedFrame = screen.getByTitle("DeskCue preview");

    expect(reloadedFrame).not.toBe(frame);

    expect(reloadedFrame).toHaveAttribute("src", stablePreviewUrl);

    rerender(
      <PreviewTabPanel
        {...props}
        previewDocumentRevision={1}
      />
    );

    expect(screen.getByTitle("DeskCue preview")).toBe(reloadedFrame);
  });

  it("replaces an old owner frame before paint and ignores its late load", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const oldFrame = screen.getByTitle("DeskCue preview");

    fireEvent.load(oldFrame);

    const nextUrl = "/api/preview/sessions/session-2/";

    rerender(
      <PreviewTabPanel
        {...props}
        previewUrl={nextUrl}
      />
    );

    const nextFrame = screen.getByTitle("DeskCue preview");

    expect(nextFrame).not.toBe(oldFrame);

    expect(nextFrame).toHaveAttribute("src", nextUrl);
    expect(screen.getByTestId("preview-frame-loading")).toBeInTheDocument();

    fireEvent.load(oldFrame);
    expect(screen.getByTestId("preview-frame-loading")).toBeInTheDocument();
    fireEvent.load(nextFrame);
    expect(screen.queryByTestId("preview-frame-loading")).not.toBeInTheDocument();
  });

  it("adopts the stable URL once when a legacy bootstrap credential is replaced", () => {
    const legacyUrl = "/api/preview/sessions/session-1/__deskcue_ticket__/temporary/";
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: legacyUrl
    });
    const legacyFrame = screen.getByTitle("DeskCue preview");

    fireEvent.load(legacyFrame);

    rerender(
      <PreviewTabPanel
        {...props}
        previewDocumentRevision={1}
        previewUrl={stablePreviewUrl}
      />
    );

    const stableFrame = screen.getByTitle("DeskCue preview");

    expect(stableFrame).not.toBe(legacyFrame);

    expect(stableFrame).toHaveAttribute("src", stablePreviewUrl);

    rerender(
      <PreviewTabPanel
        {...props}
        previewDocumentRevision={1}
        previewUrl={stablePreviewUrl}
      />
    );

    expect(screen.getByTitle("DeskCue preview")).toBe(stableFrame);
  });

  it("requests one validated frame reload", () => {
    const onReloadPreview = vi.fn();
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      onReloadPreview,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const firstFrame = screen.getByTitle("DeskCue preview");

    fireEvent.load(firstFrame);

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(onReloadPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("DeskCue preview")).toBe(firstFrame);

    rerender(
      <PreviewTabPanel
        {...props}
        onReloadPreview={onReloadPreview}
        previewReloadVersion={1}
      />
    );

    const reloadedFrame = screen.getByTitle("DeskCue preview");

    expect(reloadedFrame).not.toBe(firstFrame);

    expect(reloadedFrame).toHaveAttribute("src", stablePreviewUrl);
    expect(onReloadPreview).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["routing mode", { configuredPreviewNetworkMode: "deskcue-host" as const }],
    ["port", { configuredPreviewPort: 3000 }]
  ])("reloads the frame once after the %s ticket succeeds", (_label, changedConfig) => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const frame = screen.getByTitle("DeskCue preview");

    fireEvent.load(frame);

    rerender(
      <PreviewTabPanel
        {...props}
        {...changedConfig}
        previewUrl={stablePreviewUrl}
      />
    );

    expect(screen.getByTitle("DeskCue preview")).toBe(frame);
    expect(screen.queryByTestId("preview-frame-loading")).not.toBeInTheDocument();

    rerender(
      <PreviewTabPanel
        {...props}
        {...changedConfig}
        previewDocumentRevision={1}
        previewUrl={stablePreviewUrl}
      />
    );

    const reloadedFrame = screen.getByTitle("DeskCue preview");

    expect(reloadedFrame).not.toBe(frame);

    expect(reloadedFrame).toHaveAttribute("src", stablePreviewUrl);
    expect(screen.getByTestId("preview-frame-loading")).toBeInTheDocument();

    rerender(
      <PreviewTabPanel
        {...props}
        {...changedConfig}
        previewDocumentRevision={1}
        previewUrl={stablePreviewUrl}
      />
    );

    expect(screen.getByTitle("DeskCue preview")).toBe(reloadedFrame);
  });

  it("keeps the loading state separate from an unavailable preview", () => {
    renderPanel({ configuredPreviewPort: 5173, previewLoading: true });

    expect(screen.queryByText("No running app detected")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Preview port" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Checking preview…" })).toBeInTheDocument();
  });

  it("moves focus from a failed reload to the recovery action", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const reloadButton = screen.getByRole("button", { name: "Reload" });

    reloadButton.focus();
    fireEvent.click(reloadButton);
    rerender(
      <PreviewTabPanel
        {...props}
        previewError="Preview unavailable"
        previewUrl={null}
      />
    );

    const retryButton = screen.getByRole("button", { name: "Retry current port" });

    expect(retryButton).toHaveFocus();
    expect(retryButton.className).toContain("previewFocusHandoff");
  });

  it("does not steal focus when the user moves away during reload", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });
    const reloadButton = screen.getByRole("button", { name: "Reload" });
    const connectionButton = screen.getByRole("button", { name: "Preview connection" });

    fireEvent.click(reloadButton);
    connectionButton.focus();
    rerender(
      <PreviewTabPanel
        {...props}
        previewError="Preview unavailable"
        previewUrl={null}
      />
    );

    expect(connectionButton).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retry current port" })).not.toHaveFocus();
  });

  it("moves focus to Reload after a successful retry", () => {
    const { props, rerender } = renderPanel({
      configuredPreviewPort: 5173,
      previewError: "Preview unavailable",
      previewPort: "5173"
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry current port" }));
    rerender(<PreviewTabPanel {...props} previewError="" previewLoading />);
    rerender(
      <PreviewTabPanel
        {...props}
        previewError=""
        previewUrl={stablePreviewUrl}
      />
    );

    const reloadButton = screen.getByRole("button", { name: "Reload" });

    expect(reloadButton).toHaveFocus();
    expect(reloadButton.className).toContain("previewFocusHandoff");
  });

  it("offers retry and another detected app when the configured preview is unavailable", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewCandidates: [{ configured: true, port: 3000 }],
      previewError: "Preview unavailable",
      previewPort: "5173"
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable");
    expect(screen.getByRole("button", { name: "Retry current port" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Local app on port 3000" })).toBeEnabled();
    expect(screen.getByText("Select detected app")).toBeInTheDocument();
    expect(screen.queryByText("Current preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop preview" })).toBeEnabled();
    expect(screen.getByRole("status", { name: "Preview unavailable" })).toHaveTextContent("Offline");
  });

  it("keeps setup visible when a stale ticket error arrives before configuration", () => {
    renderPanel({ previewError: "Enable preview before opening it." });

    expect(screen.getByText("No running app detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeInTheDocument();
    expect(screen.queryByText("Preview could not connect")).not.toBeInTheDocument();
  });

  it("shows the only detected app without overwriting the port draft", () => {
    const onChangePreviewPort = vi.fn();

    renderPanel({
      previewCandidates: [{ configured: false, port: 5173 }],
      onChangePreviewPort
    });

    expect(onChangePreviewPort).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Local app on port 5173" }))
      .toBeInTheDocument();
    expect(screen.getByText("Select detected app")).toBeInTheDocument();
    expect(screen.getByText("Use another port")).toBeInTheDocument();
  });

  it("does not restore the detected port after the user clears the manual field", () => {
    const onChangePreviewPort = vi.fn();
    const { rerender, props } = renderPanel({
      previewCandidates: [{ configured: false, port: 5173 }],
      previewPort: "5173",
      onChangePreviewPort
    });

    fireEvent.click(screen.getByText("Use another port"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preview port" }), {
      target: { value: "" }
    });

    expect(onChangePreviewPort).toHaveBeenLastCalledWith("");

    rerender(<PreviewTabPanel {...props} previewPort="" />);
    expect(onChangePreviewPort).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Preview port" })).toHaveValue("");
  });
});
