import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscriptPreviewEntry } from "./TranscriptPreviewEntry";

describe("TranscriptPreviewEntry", () => {
  it("asks whether to open or download a local Markdown link", () => {
    render(
      <TranscriptPreviewEntry
        assetContext={{ agentSessionId: "agent-session-1" }}
        entry={{
          id: "entry-1",
          role: "assistant",
          text: "[DESKCUE_CHANGE_VALIDATION.md](</D:/work/DeskCueWorkspace/DESKCUE_CHANGE_VALIDATION.md>)",
          timestamp: "2026-08-23T12:00:00.000Z"
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "DESKCUE_CHANGE_VALIDATION.md" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });
});
