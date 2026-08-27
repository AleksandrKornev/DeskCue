import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRuntimePanel } from "./ModelRuntimePanel";

function ModelRuntimePanelFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">Open model context</button>
      {isOpen ? <ModelRuntimePanel onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("ModelRuntimePanel", () => {
  it("enters and restores focus around Escape", () => {
    render(<ModelRuntimePanelFixture />);
    const trigger = screen.getByRole("button", { name: "Open model context" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Model and runtime context" });

    expect(dialog).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
