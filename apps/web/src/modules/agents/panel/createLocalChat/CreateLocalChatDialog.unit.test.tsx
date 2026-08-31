import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { CreateLocalChatDialog } from "./CreateLocalChatDialog";
import type { CreateLocalChatDialogProps } from "./types";

function renderDialog(overrides: Partial<CreateLocalChatDialogProps> = {}) {
  const props: CreateLocalChatDialogProps = {
    isOpen: true,
    isSubmitting: false,
    models: [],
    modelsLoadState: "ready",
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onModelChange: vi.fn(),
    onRetryModels: vi.fn(),
    onRuntimeChange: vi.fn(),
    onWorkspaceChange: vi.fn(),
    runtimes: [{
      description: "Uses the models installed in LM Studio.",
      id: "lm-studio",
      label: "LM Studio",
      status: "offline",
      statusText: "Offline · 1 model"
    }],
    selectedModelId: "",
    selectedRuntimeId: "lm-studio",
    selectedWorkspaceId: "",
    workspaces: [],
    ...overrides
  };

  const view = render(<CreateLocalChatDialog {...props} />);

  return { props, ...view };
}

it("shows LM Studio wake-up progress instead of an empty catalog", () => {
  renderDialog({
    modelsLoadState: "loading",
    runtimes: [{
      description: "Uses the models installed in LM Studio.",
      id: "lm-studio",
      label: "LM Studio",
      status: "loading",
      statusText: "Starting Local Server…"
    }]
  });

  expect(screen.getByRole("dialog", { name: "New local chat" })).toHaveAccessibleDescription(
    "Choose a local runtime, model, and optional workspace."
  );

  expect(screen.getByRole("group", { name: "Runtime" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("");
  expect(screen.getByRole("option", { name: "Starting LM Studio…" })).toBeInTheDocument();
  expect(screen.queryByText(/No installed chat models/i)).not.toBeInTheDocument();
});

it("keeps the create action outside the scrollable form while submitting that form", () => {
  const { props } = renderDialog({
    models: [{ id: "model-1", label: "Model 1" }],
    selectedModelId: "model-1"
  });
  const createButton = screen.getByRole("button", { name: "Create chat" });
  const form = screen.getByRole("dialog").querySelector("form");

  expect(form).not.toContainElement(createButton);
  expect(createButton).toHaveAttribute("form", form?.id);

  fireEvent.click(createButton);

  expect(props.onCreate).toHaveBeenCalledTimes(1);
});

it("keeps a catalog failure distinct and lets the user retry the wake-up", () => {
  const { props } = renderDialog({
    modelErrorMessage: "LM Studio Local Server did not start",
    modelsLoadState: "error"
  });

  expect(screen.getByRole("alert")).toHaveTextContent("LM Studio Local Server did not start");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(props.onRetryModels).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/No installed chat models/i)).not.toBeInTheDocument();
});

it("announces retry progress and hands focus to the model after recovery", async () => {
  const longError = "Catalog failure ".repeat(60);
  const { props, rerender } = renderDialog({
    modelErrorMessage: longError,
    modelsLoadState: "error"
  });
  const retryButton = screen.getByRole("button", { name: "Retry" });

  retryButton.focus();
  fireEvent.click(retryButton);
  rerender(<CreateLocalChatDialog {...props} modelsLoadState="loading" />);

  await waitFor(() => expect(screen.getByRole("status").parentElement).toHaveFocus());
  expect(screen.getByRole("dialog").querySelector("form")).toHaveAttribute("aria-busy", "true");

  rerender(
    <CreateLocalChatDialog
      {...props}
      models={[{ id: "model-1", label: "Model 1" }]}
      modelsLoadState="ready"
    />
  );

  await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveFocus());
});

it("hands focus to Retry when a retried catalog request fails again", async () => {
  const { props, rerender } = renderDialog({ modelsLoadState: "error" });

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  rerender(<CreateLocalChatDialog {...props} modelsLoadState="loading" />);

  await waitFor(() => expect(screen.getByRole("status").parentElement).toHaveFocus());

  rerender(<CreateLocalChatDialog {...props} modelsLoadState="error" />);

  await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus());
});

it("reveals a focused Retry inside the modal body when a long error returns", async () => {
  const longError = "Catalog failure ".repeat(60);
  const { props, rerender } = renderDialog({
    modelErrorMessage: longError,
    modelsLoadState: "error"
  });
  const scrollRegion = screen.getByRole("dialog").querySelector("form")?.parentElement;

  expect(scrollRegion).toBeInstanceOf(HTMLElement);

  const getBounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function getTestBounds(this: HTMLElement) {
      if (this === scrollRegion) return new DOMRect(0, 118, 360, 304);

      if (this instanceof HTMLButtonElement && this.textContent?.trim() === "Retry") {
        return new DOMRect(14, 700, 332, 48);
      }

      if (this.getAttribute("tabindex") === "-1") return new DOMRect(14, 300, 332, 20);

      return new DOMRect();
    });

  try {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    rerender(<CreateLocalChatDialog {...props} modelsLoadState="loading" />);

    await waitFor(() => expect(screen.getByRole("status").parentElement).toHaveFocus());
    expect(scrollRegion).toHaveProperty("scrollTop", 0);

    rerender(<CreateLocalChatDialog {...props} modelsLoadState="error" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus());
    expect(scrollRegion).toHaveProperty("scrollTop", 330);
  } finally {
    getBounds.mockRestore();
  }
});

it("does not steal focus when the user moves on while retry is pending", async () => {
  const { props, rerender } = renderDialog({ modelsLoadState: "error" });

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  rerender(<CreateLocalChatDialog {...props} modelsLoadState="loading" />);

  const workspaceSelect = screen.getByRole("combobox", { name: "Workspace (optional)" });

  workspaceSelect.focus();
  rerender(
    <CreateLocalChatDialog
      {...props}
      models={[{ id: "model-1", label: "Model 1" }]}
      modelsLoadState="ready"
    />
  );

  await waitFor(() => expect(workspaceSelect).toHaveFocus());
  expect(screen.getByRole("combobox", { name: "Model" })).not.toHaveFocus();
});

it("reveals and focuses a terminal creation error when submit still owns focus", async () => {
  const { props, rerender } = renderDialog({
    models: [{ id: "model-1", label: "Model 1" }],
    selectedModelId: "model-1"
  });
  const createButton = screen.getByRole("button", { name: "Create chat" });

  createButton.focus();
  fireEvent.click(createButton);
  rerender(<CreateLocalChatDialog {...props} isSubmitting />);
  rerender(
    <CreateLocalChatDialog
      {...props}
      errorMessage="DeskCue could not create the chat."
      isSubmitting={false}
    />
  );

  await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
});

it("does not steal focus for a terminal creation error after the user moves on", async () => {
  const { props, rerender } = renderDialog({
    models: [{ id: "model-1", label: "Model 1" }],
    selectedModelId: "model-1"
  });
  const createButton = screen.getByRole("button", { name: "Create chat" });

  createButton.focus();
  fireEvent.click(createButton);
  rerender(<CreateLocalChatDialog {...props} isSubmitting />);

  const closeButton = screen.getByRole("button", { name: "Close new local chat dialog" });

  closeButton.focus();
  rerender(
    <CreateLocalChatDialog
      {...props}
      errorMessage="DeskCue could not create the chat."
      isSubmitting={false}
    />
  );

  await waitFor(() => expect(closeButton).toHaveFocus());
});
