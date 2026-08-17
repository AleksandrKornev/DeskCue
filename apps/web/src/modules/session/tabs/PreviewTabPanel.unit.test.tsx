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
    expect(screen.getByRole("status", { name: "Loading preview page" })).toBeInTheDocument();
    fireEvent.load(screen.getByTitle("DeskCue preview"));
    expect(screen.queryByRole("status", { name: "Loading preview page" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("status", { name: "Live · port 5173" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(frame).toBeInTheDocument();
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
    renderPanel({
      configuredPreviewPort: 5173,
      previewPort: "5173",
      previewUrl: stablePreviewUrl
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview connection" }));
    expect(screen.getByRole("textbox", { name: "Preview port" })).toHaveValue("5173");
    expect(screen.getByRole("button", { name: "Switch preview" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /From this device/ })).toBeChecked();
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
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveTextContent("Stopping…");

    await act(async () => {
      finishStop(true);
      await Promise.resolve();
    });
    expect(stopButton).toBeEnabled();
    expect(stopButton).toHaveTextContent("Stop");
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
    expect(screen.queryByRole("status", { name: "Loading preview page" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("status", { name: "Loading preview page" })).toBeInTheDocument();

    fireEvent.load(oldFrame);
    expect(screen.getByRole("status", { name: "Loading preview page" })).toBeInTheDocument();
    fireEvent.load(nextFrame);
    expect(screen.queryByRole("status", { name: "Loading preview page" })).not.toBeInTheDocument();
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

  it("reloads the frame exactly once without asking for new credentials", () => {
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
    expect(screen.queryByRole("status", { name: "Loading preview page" })).not.toBeInTheDocument();

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
    expect(screen.getByRole("status", { name: "Loading preview page" })).toBeInTheDocument();

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
  });

  it("offers retry and another detected app when the configured preview is unavailable", () => {
    renderPanel({
      configuredPreviewPort: 5173,
      previewCandidates: [{ configured: false, port: 3000 }],
      previewError: "Preview unavailable",
      previewPort: "5173"
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable");
    expect(screen.getByRole("button", { name: "Retry current port" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Local app on port 3000" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Switch preview" })).toBeEnabled();
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
