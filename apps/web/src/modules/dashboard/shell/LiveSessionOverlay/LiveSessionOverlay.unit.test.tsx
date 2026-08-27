import {
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

import { LiveSessionOverlay } from "./LiveSessionOverlay";

function LiveSessionOverlayFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOpen(true)}>Open tools overlay</button>
      {isOpen ? (
        <LiveSessionOverlay
          toolsContent={<button type="button">Tool action</button>}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </main>
  );
}

describe("LiveSessionOverlay", () => {
  it("uses the shared modal focus lifecycle", () => {
    render(<LiveSessionOverlayFixture />);
    const trigger = screen.getByRole("button", { name: "Open tools overlay" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Tools and diagnostics" });
    const closeButton = screen.getByRole("button", { name: "Close overlay" });

    expect(dialog).toHaveFocus();
    expect(trigger.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger.inert).toBeFalsy();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });
});
