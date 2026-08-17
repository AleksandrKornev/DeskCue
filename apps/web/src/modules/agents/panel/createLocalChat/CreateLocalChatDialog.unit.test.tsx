import { fireEvent, render, screen } from "@testing-library/react";
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
  render(<CreateLocalChatDialog {...props} />);
  return props;
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

  expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("");
  expect(screen.getByRole("option", { name: "Starting LM Studio…" })).toBeInTheDocument();
  expect(screen.queryByText(/No installed chat models/i)).not.toBeInTheDocument();
});

it("keeps a catalog failure distinct and lets the user retry the wake-up", () => {
  const props = renderDialog({
    modelErrorMessage: "LM Studio Local Server did not start",
    modelsLoadState: "error"
  });

  expect(screen.getByRole("alert")).toHaveTextContent("LM Studio Local Server did not start");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(props.onRetryModels).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/No installed chat models/i)).not.toBeInTheDocument();
});
