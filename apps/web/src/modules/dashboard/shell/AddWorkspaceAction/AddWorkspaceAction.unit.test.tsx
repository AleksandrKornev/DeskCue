import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn()
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

import { AddWorkspaceAction } from "./AddWorkspaceAction";

const defaultProps = {
  canOpenNativeDialogs: true,
  loading: false,
  pickingWorkspace: false,
  workspacePath: "",
  onAddWorkspace: vi.fn().mockResolvedValue({ status: "created" }),
  onChangeWorkspacePath: vi.fn(),
  onPickWorkspace: vi.fn().mockResolvedValue({ status: "created" })
};

describe("AddWorkspaceAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("presents the immediate host picker before the manual path disclosure", () => {
    render(<AddWorkspaceAction {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(screen.getByRole("dialog", { name: "Add workspace" })).toBeInTheDocument();
    expect(screen.getByText("Host browser only · registers immediately")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose and add local folder" })).toBeInTheDocument();
    expect(screen.getByText("Add a path manually")).toBeInTheDocument();
  });

  it("shows only the selected workspace registration method", async () => {
    render(<AddWorkspaceAction {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const disclosure = screen.getByText("Add a path manually");

    fireEvent.click(disclosure);

    await waitFor(() => expect(
      screen.queryByRole("region", { name: "Choose on this machine" })
    ).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Workspace folder" })).toBeInTheDocument();

    fireEvent.click(disclosure);

    await waitFor(() => expect(
      screen.getByRole("region", { name: "Choose on this machine" })
    ).toBeInTheDocument());
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
  });

  it("shows a scoped manual-path error and marks the input invalid", async () => {
    const onAddWorkspace = vi.fn().mockResolvedValue({
      status: "failed",
      error: "Choose a readable folder."
    });

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);

    const input = screen.getByRole("textbox", { name: "Workspace folder" });

    await waitFor(() => expect(input).toHaveAccessibleDescription(
      "The folder remains on the DeskCue host. Choose a readable folder."
    ));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Choose a readable folder.");
    expect(alert.closest("form")).not.toBeNull();
  });

  it("keeps the active manual flow visible until its request settles", async () => {
    let resolveAddWorkspace!: (result: { status: "failed"; error: string }) => void;
    const onAddWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveAddWorkspace = resolve;
    }));

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const disclosure = screen.getByText("Add a path manually");

    fireEvent.click(disclosure);
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);

    expect(disclosure).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(disclosure);
    expect(disclosure.closest("details")).toHaveAttribute("open");

    await act(() => {
      resolveAddWorkspace({ status: "failed", error: "Choose a readable folder." });

      return Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a readable folder.");
    expect(screen.getByRole("textbox", { name: "Workspace folder" })).toHaveFocus();
  });

  it("does not steal focus after the user moves away from a pending manual path", async () => {
    let resolveAddWorkspace!: (result: { status: "failed"; error: string }) => void;
    const onAddWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveAddWorkspace = resolve;
    }));

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);
    const closeButton = screen.getByRole("button", { name: "Close" });

    closeButton.focus();

    await act(() => {
      resolveAddWorkspace({ status: "failed", error: "Choose a readable folder." });

      return Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Workspace folder" })).not.toHaveFocus();
  });

  it("keeps a settled path error visible if the user switches methods", async () => {
    const onAddWorkspace = vi.fn().mockResolvedValue({
      status: "failed",
      error: "Choose a readable folder."
    });

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const disclosure = screen.getByText("Add a path manually");

    fireEvent.click(disclosure);
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);
    await screen.findByRole("alert");
    fireEvent.click(disclosure);

    await waitFor(() => expect(disclosure.closest("details")).not.toHaveAttribute("open"));

    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Choose a readable folder.");
    expect(alert.closest("form")).toBeNull();
  });

  it("keeps a long unbroken path error attached to the manual field", async () => {
    const longError = `Invalid path: ${"E".repeat(500)}`;
    const onAddWorkspace = vi.fn().mockResolvedValue({
      status: "failed",
      error: longError
    });

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(longError));
    expect(screen.getByRole("textbox", { name: "Workspace folder" })).toHaveFocus();
  });

  it("closes after the host picker creates a workspace", async () => {
    render(<AddWorkspaceAction {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add workspace" })).not.toBeInTheDocument();
    });

    expect(toastMocks.success).toHaveBeenCalledWith("Workspace added.");
  });

  it("keeps picker failures visible while manual entry stays collapsed", async () => {
    const onPickWorkspace = vi.fn().mockResolvedValue({
      status: "failed",
      error: "Folder picker is unavailable."
    });

    render(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));

    const alert = await screen.findByRole("alert");
    const pickerButton = screen.getByRole("button", { name: "Choose and add local folder" });

    expect(alert).toHaveTextContent("Folder picker is unavailable.");
    expect(pickerButton).toHaveAccessibleDescription("Folder picker is unavailable.");
    expect(alert.closest("section")).not.toBeNull();
    expect(screen.getByText("Add a path manually").closest("details")).not.toHaveAttribute("open");
  });

  it("keeps picker work selected while pending and preserves its settled error", async () => {
    let resolvePicker!: (result: { status: "failed"; error: string }) => void;
    const onPickWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolvePicker = resolve;
    }));

    render(<AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));
    const disclosure = screen.getByText("Add a path manually");

    expect(disclosure).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(disclosure);
    expect(disclosure.closest("details")).not.toHaveAttribute("open");

    await act(() => {
      resolvePicker({ status: "failed", error: "Folder picker is unavailable." });

      return Promise.resolve();
    });

    fireEvent.click(disclosure);

    expect(screen.getByRole("alert")).toHaveTextContent("Folder picker is unavailable.");
  });

  it("keeps the dialog open when the host picker is cancelled", async () => {
    const onPickWorkspace = vi.fn().mockResolvedValue({ status: "cancelled" });

    render(<AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));

    await waitFor(() => expect(onPickWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog", { name: "Add workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores unowned focus after the host picker becomes available again", async () => {
    let resolvePicker!: (result: { status: "cancelled" }) => void;
    const onPickWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolvePicker = resolve;
    }));
    const view = render(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));
    view.rerender(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} pickingWorkspace />
    );

    view.rerender(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    await act(() => {
      resolvePicker({ status: "cancelled" });

      return Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Choose and add local folder" })).toHaveFocus();
    });
  });

  it("does not steal focus after the user moves away from a pending picker", () => {
    const onPickWorkspace = vi.fn().mockReturnValue(new Promise(() => undefined));
    const view = render(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));
    view.rerender(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} pickingWorkspace />
    );

    const disclosure = screen.getByText("Add a path manually").closest("summary")!;

    disclosure.focus();
    view.rerender(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    expect(disclosure).toHaveFocus();
  });

  it("clears picker focus recovery when native dialog capability disappears", async () => {
    let resolvePicker!: (result: { status: "cancelled" }) => void;
    const onPickWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolvePicker = resolve;
    }));
    const view = render(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose and add local folder" }));
    view.rerender(
      <AddWorkspaceAction
        {...defaultProps}
        canOpenNativeDialogs={false}
        onPickWorkspace={onPickWorkspace}
        pickingWorkspace
      />
    );

    const input = await screen.findByRole("textbox", { name: "Workspace folder" });

    input.focus();
    view.rerender(
      <AddWorkspaceAction {...defaultProps} onPickWorkspace={onPickWorkspace} />
    );

    await act(() => {
      resolvePicker({ status: "cancelled" });

      return Promise.resolve();
    });

    expect(input).toHaveFocus();
  });

  it("allows dismissing the dialog while a workspace action is pending", () => {
    render(<AddWorkspaceAction {...defaultProps} pickingWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Add workspace" })).not.toBeInTheDocument();
  });

  it("keeps the previous pending action visible after the dialog is reopened", () => {
    const onAddWorkspace = vi.fn().mockReturnValue(new Promise(() => undefined));

    render(
      <AddWorkspaceAction
        {...defaultProps}
        loading
        workspacePath={"D:\\work\\first-workspace"}
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Previous add attempt is still running: Adding D:\\work\\first-workspace…"
    );

    expect(screen.getByText("Add a path manually").closest("details")).toHaveAttribute("open");
  });

  it("ignores a stale failure after the dialog is closed and reopened", async () => {
    let resolveAddWorkspace!: (result: { status: "failed"; error: string }) => void;
    const onAddWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveAddWorkspace = resolve;
    }));

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="missing-folder"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    await act(() => {
      resolveAddWorkspace({ status: "failed", error: "Choose a readable folder." });

      return Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "Add workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Add a path manually").closest("details")).toHaveAttribute("open");
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Previous add attempt failed: Choose a readable folder.",
      { duration: 5000 }
    );
  });

  it("keeps a reopened dialog open when an earlier request succeeds", async () => {
    let resolveAddWorkspace!: (result: { status: "created" }) => void;
    const onAddWorkspace = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveAddWorkspace = resolve;
    }));

    render(
      <AddWorkspaceAction
        {...defaultProps}
        workspacePath="first-workspace"
        onAddWorkspace={onAddWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    fireEvent.click(screen.getByText("Add a path manually"));
    fireEvent.submit(screen.getByRole("textbox", { name: "Workspace folder" }).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    await act(() => {
      resolveAddWorkspace({ status: "created" });

      return Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "Add workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Previous add attempt finished. Workspace added."
    );
  });

  it("explains the host boundary when native dialogs are unavailable", () => {
    render(<AddWorkspaceAction {...defaultProps} canOpenNativeDialogs={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(screen.queryByRole("button", { name: "Choose and add local folder" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Enter a path on the DeskCue host").closest("details"))
      .toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: "Workspace folder" }))
      .toHaveAttribute("placeholder", "Absolute path on the DeskCue host");
    expect(screen.getByText("The folder remains on the DeskCue host.")).toBeInTheDocument();
  });
});
