import {
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

import { AttachmentLightbox } from "./AttachmentLightbox";

function AttachmentLightboxFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">Open preview</button>
      {isOpen ? (
        <AttachmentLightbox
          displayName="fixture.png"
          downloadHref="https://example.test/download"
          openHref="https://example.test/open"
          previewKind="image"
          previewUrl="data:image/png;base64,AA=="
          secondaryLabel="Image"
          textPreview=""
          textPreviewState="idle"
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}

function AttachmentLightboxWithoutActionsFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">Open preview</button>
      {isOpen ? (
        <AttachmentLightbox
          displayName="fixture.png"
          previewKind="image"
          previewUrl="data:image/png;base64,AA=="
          secondaryLabel="Image"
          textPreview=""
          textPreviewState="idle"
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("AttachmentLightbox", () => {
  it("enters, traps, closes and restores keyboard focus", () => {
    render(<AttachmentLightboxFixture />);
    const trigger = screen.getByRole("button", { name: "Open preview" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "fixture.png" });
    const dialogQueries = within(dialog);
    const openLink = dialogQueries.getByRole("link", { name: "Open" });
    const previewRegion = dialogQueries.getByRole("region", { name: "fixture.png preview" });

    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(previewRegion).toHaveFocus();

    previewRegion.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(openLink).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("keeps focus on the dialog when its only action is hidden", () => {
    render(<AttachmentLightboxWithoutActionsFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));

    const dialog = screen.getByRole("dialog", { name: "fixture.png" });
    const closeButton = within(dialog).getByRole("button", { name: "Close preview" });
    const previewRegion = within(dialog).getByRole("region", { name: "fixture.png preview" });

    closeButton.style.display = "none";
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(previewRegion).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(previewRegion).toHaveFocus();
  });
});
