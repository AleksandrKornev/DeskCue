import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomStorageLimitDialog } from "./CustomStorageLimitDialog";

const callbacks = {
  onClose: vi.fn(),
  onCustomStorageMaxMbChange: vi.fn(),
  onSubmit: vi.fn()
};

function renderDialog(locked: boolean) {
  return render(
    <CustomStorageLimitDialog
      customStorageMaxMb="50"
      isOpen
      locked={locked}
      savingStorageBudget={false}
      {...callbacks}
    />
  );
}

describe("CustomStorageLimitDialog lock state", () => {
  it("turns an open dialog into a coherent locked state after an env transition", () => {
    const { rerender } = renderDialog(false);

    expect(screen.getByRole("spinbutton", { name: "Custom storage limit in MiB" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save limit" })).toBeEnabled();

    rerender(
      <CustomStorageLimitDialog
        customStorageMaxMb="50"
        isOpen
        locked
        savingStorageBudget={false}
        {...callbacks}
      />
    );

    const lockNotice = screen.getByRole("status");

    expect(lockNotice).toHaveTextContent(/controlled by the daemon environment/i);
    expect(screen.getByRole("spinbutton", { name: "Custom storage limit in MiB" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Custom storage limit in MiB" })).toHaveAttribute(
      "aria-describedby",
      lockNotice.id
    );

    expect(screen.getByRole("button", { name: "Save limit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
