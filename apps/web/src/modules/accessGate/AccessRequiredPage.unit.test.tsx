import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessRequiredPage } from "./AccessRequiredPage";

const mocks = vi.hoisted(() => ({
  connectionPreparationFailure: null as {
    message: string;
    requestAccepted: boolean;
    retryOriginal: boolean;
    title: string;
  } | null
}));

vi.mock("@api/connection", () => ({
  buildCurrentDaemonAccessSettingsUrl: () =>
    "http://deskcue.test:4310/settings?tab=access"
}));

vi.mock("@api/connection/pairing", () => ({
  clearConnectionPreparationFailure: vi.fn(),
  readConnectionPreparationFailure: () => mocks.connectionPreparationFailure
}));

vi.mock("@components/DeskCueWordmark", () => ({
  DeskCueWordmark: () => <span aria-hidden="true">DeskCue</span>
}));

function renderAccessRequiredPage(initialEntry = "/connect") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AccessRequiredPage />
    </MemoryRouter>
  );
}

describe("AccessRequiredPage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.connectionPreparationFailure = null;
  });

  it("explains origin-scoped pairing without promoting a specific network product", () => {
    renderAccessRequiredPage();

    expect(screen.getByText(/different address is treated as a separate client/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/tailscale/i)).not.toBeInTheDocument();
  });

  it("uses the current daemon address and keeps the access check before the instructions", () => {
    renderAccessRequiredPage();

    const retryButton = screen.getByRole("button", { name: "Check access again" });
    const firstStep = screen.getByText(/On the host computer, open/i);

    expect(screen.getByText("http://deskcue.test:4310/settings?tab=access"))
      .toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1:4100/)).not.toBeInTheDocument();
    expect(screen.getByText("Go to Connections and create a device pairing link"))
      .toBeInTheDocument();
    expect(screen.getByText(/created from Settings > Connections\./))
      .toBeInTheDocument();
    expect(screen.queryByText(/Go to Access/)).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Back to DeskCue dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pairing steps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pair this browser" })).toHaveFocus();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByLabelText("Step 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 3")).toBeInTheDocument();
    expect(retryButton.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("announces the latest pairing failure with a fresh-link action", () => {
    mocks.connectionPreparationFailure = {
      message: "This pairing link is invalid, expired, or already used. Create a fresh device link.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    };

    renderAccessRequiredPage();

    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Pairing link did not work");
    expect(alert).toHaveTextContent(/invalid, expired, or already used/i);
    expect(alert).toHaveTextContent(/fresh device link/i);
  });

  it("removes a rejected saved credential without hiding the retry path", () => {
    localStorage.setItem("deskcue.accessDeviceId", "rejected-device");

    renderAccessRequiredPage();

    expect(screen.getByText("Saved browser access no longer works")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear saved access" }));

    expect(localStorage.getItem("deskcue.accessDeviceId")).toBeNull();
    expect(screen.queryByText("Saved browser access no longer works")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check access again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check access again" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Saved browser access cleared");
  });

  it("keeps saved access intact and prioritizes retry while the daemon is offline", () => {
    localStorage.setItem("deskcue.accessDeviceId", "unverified-device");

    renderAccessRequiredPage("/connect?reason=offline&from=%2Fsessions%2Fsession-1");

    expect(screen.getByRole("heading", { name: "Cannot reach DeskCue" })).toBeInTheDocument();
    expect(screen.getByText("Your saved browser access was not changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try connection again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear saved access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pairing steps" })).not.toBeInTheDocument();
    expect(localStorage.getItem("deskcue.accessDeviceId")).toBe("unverified-device");
  });

  it("keeps an offline one-time link actionable instead of promising a generic retry", () => {
    renderAccessRequiredPage(
      "/connect?reason=offline&from=%2Fpair%2Fpair-code"
    );

    expect(screen.getByRole("heading", { name: "Cannot reach DeskCue" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retry pairing link" })).toBeInTheDocument();
    expect(screen.getByText(/opens the original one-time pairing link/i)).toBeInTheDocument();
    expect(screen.queryByText(/successful check will return/i)).not.toBeInTheDocument();
  });

  it("keeps a pending one-time link actionable after the daemon becomes reachable", () => {
    renderAccessRequiredPage(
      "/connect?reason=preparation&from=%2Frecover%2Frecovery-code"
    );

    expect(screen.getByRole("heading", { name: "Retry recovery code" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retry recovery code" })).toBeInTheDocument();
    expect(screen.getByText(/DeskCue is reachable again/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pairing steps" })).not.toBeInTheDocument();
  });

  it("shows a failed one-time link without discarding valid browser access", () => {
    mocks.connectionPreparationFailure = {
      message: "Create a fresh device link in Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    };

    renderAccessRequiredPage("/connect?reason=preparation-failed");

    expect(screen.getByText("One-time link failed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pairing link did not work" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(/fresh device link/i);
    expect(screen.getByRole("button", { name: "Check DeskCue access" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pairing steps" })).not.toBeInTheDocument();
  });

  it("offers the original one-time link again only after a retryable transport failure", () => {
    mocks.connectionPreparationFailure = {
      message: "DeskCue could not complete pairing because of a temporary connection or " +
        "service problem. Try the original pairing link again.",
      requestAccepted: false,
      retryOriginal: true,
      title: "Pairing link did not work"
    };

    renderAccessRequiredPage(
      "/connect?reason=preparation&from=%2Fpair%2Fretryable-code"
    );

    expect(screen.getByText("One-time link needs retry")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry pairing link" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/temporary connection or service problem/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/try the original pairing link again/i);
    expect(screen.queryByText(/retry opens the original one-time/i)).not.toBeInTheDocument();
  });

  it("describes an accepted request without also calling the one-time link failed", () => {
    mocks.connectionPreparationFailure = {
      message: "DeskCue accepted this pairing request, but the browser could not finish saving " +
        "access. Check DeskCue access. If access is still unavailable, create a fresh device link.",
      requestAccepted: true,
      retryOriginal: false,
      title: "DeskCue access needs checking"
    };

    renderAccessRequiredPage("/connect?reason=preparation-failed");

    expect(screen.getByText("Access setup incomplete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DeskCue access needs checking" })).toHaveFocus();
    expect(screen.getByText(/accepted this one-time request/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/accepted this pairing request/i);
    expect(screen.getByRole("button", { name: "Check DeskCue access" })).toBeInTheDocument();
    expect(screen.queryByText("One-time link failed")).not.toBeInTheDocument();
    expect(screen.queryByText(/could not apply this one-time link/i)).not.toBeInTheDocument();
  });

  it("shows the return hint only for a validated local return path", () => {
    const validView = renderAccessRequiredPage("/connect?from=%2Fsessions%2Fsession-1");

    expect(screen.getByText(/return to the page you tried to open/i)).toBeInTheDocument();

    validView.unmount();
    renderAccessRequiredPage("/connect?from=%2F%2Fexample.com");

    expect(screen.queryByText(/return to the page you tried to open/i)).not.toBeInTheDocument();
  });
});
