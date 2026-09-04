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

    fireEvent.click(screen.getByRole("link", { name: "DESKCUE_CHANGE_VALIDATION.md" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("keeps raw Windows artifact links actionable in the chat preview", () => {
    render(
      <TranscriptPreviewEntry
        assetContext={{ agentSessionId: "agent-session-1" }}
        entry={{
          id: "entry-2",
          role: "assistant",
          text: "[mobile evidence](D:\\work\\DeskCueWorkspace\\mobile-evidence.png)",
          timestamp: "2026-08-23T12:01:00.000Z"
        }}
      />
    );

    expect(screen.getByRole("link", { name: "mobile evidence" })).toHaveAttribute(
      "title",
      "D:/work/DeskCueWorkspace/mobile-evidence.png"
    );
  });

  it("keeps an open asset dialog mounted while chat detail refreshes", () => {
    const entry = {
      id: "entry-refresh",
      role: "assistant" as const,
      text: "[report](D:\\work\\DeskCueWorkspace\\report.txt)",
      timestamp: "2026-08-23T12:02:00.000Z"
    };

    const view = render(
      <TranscriptPreviewEntry
        assetContext={{ agentSessionId: "agent-session-1" }}
        entry={entry}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "report" }));
    expect(screen.getByRole("dialog", { name: "report.txt" })).toBeInTheDocument();

    view.rerender(
      <TranscriptPreviewEntry
        assetContext={{ agentSessionId: "agent-session-1" }}
        entry={{ ...entry }}
      />
    );

    expect(screen.getByRole("dialog", { name: "report.txt" })).toBeInTheDocument();
  });
});
