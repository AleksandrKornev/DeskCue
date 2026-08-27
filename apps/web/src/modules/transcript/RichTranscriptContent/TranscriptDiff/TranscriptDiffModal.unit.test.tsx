import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiffFileGroup } from "@modules/transcript/RichTranscriptContent/types";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

import { TranscriptDiffModal } from "./TranscriptDiffModal";

const diffGroup = {
  additions: 1,
  changeType: "modified",
  deletions: 0,
  displayPath: "src/fixture.ts",
  parts: [{
    changeType: "modified",
    text: "+const fixture = true;",
    title: "Updated src/fixture.ts",
    type: "diff"
  }]
} as unknown as DiffFileGroup;

function TranscriptDiffModalFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">Open diff</button>
      {isOpen ? (
        <TranscriptDiffModal group={diffGroup} onClose={() => setIsOpen(false)} />
      ) : null}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("TranscriptDiffModal", () => {
  it("enters and restores focus around Escape", () => {
    render(<TranscriptDiffModalFixture />);
    const trigger = screen.getByRole("button", { name: "Open diff" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "src/fixture.ts" });

    expect(dialog).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
