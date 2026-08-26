import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TranscriptPart } from "@deskcue/protocol";

import { groupSecondaryTranscriptParts } from "./helpers";
import { RichTranscriptContent } from "./RichTranscriptContent";

function toolCall(index: number): TranscriptPart {
  return {
    argumentsText: `argument-${index}`,
    namespace: "test",
    toolName: `tool-${index}`,
    type: "tool_call"
  };
}

function toolResult(index: number): TranscriptPart {
  return {
    status: "completed",
    text: `result-${index}`,
    toolName: `tool-${index}`,
    type: "tool_result"
  };
}

describe("RichTranscriptContent", () => {
  it("asks whether to open or download a local Markdown link", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[DESKCUE_CHANGE_VALIDATION.md](</D:/work/DeskCueWorkspace/DESKCUE_CHANGE_VALIDATION.md>)"
          }],
          text: ""
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "DESKCUE_CHANGE_VALIDATION.md" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("treats local video Markdown embeds as files instead of unsupported images", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "![DeskCue E2E](D:/work/review/deskcue-e2e.mp4)"
          }],
          text: ""
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "DeskCue E2E" }));

    expect(screen.queryByRole("img", { name: "DeskCue E2E" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("keeps large tool groups bounded until the user asks for every detail", () => {
    const parts = Array.from({ length: 12 }, (_, index) => toolCall(index + 1));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools (12)"));

    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getByText("Showing the latest 8 of 12 events · 8 details")).toBeInTheDocument();
    expect(screen.queryByText("test.tool-1")).not.toBeInTheDocument();
    expect(screen.getByText("test.tool-12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 12 details" }));
    expect(screen.getAllByText("Tool call")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show latest 8 events" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Show latest 8 events" }));
    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getByText("Showing the latest 8 of 12 events · 8 details")).toBeInTheDocument();
  });

  it("keeps call/result pairs intact when limiting mixed tool activity", () => {
    const parts: TranscriptPart[] = [];

    for (let index = 1; index <= 10; index += 1) {
      parts.push(toolCall(index));
      if (index === 6) parts.push({ detail: "still running", label: "Progress", type: "status" });
      parts.push(toolResult(index));
    }

    parts.push(toolCall(11));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools and details (22)"));

    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getAllByText("Tool result")).toHaveLength(7);
    expect(screen.queryByText("test.tool-3")).not.toBeInTheDocument();
    expect(screen.getByText("test.tool-4")).toBeInTheDocument();
    expect(screen.getByText("test.tool-11")).toBeInTheDocument();
    expect(screen.getByText("Showing the latest 8 of 11 events · 16 details"))
      .toBeInTheDocument();
    expect(screen.getAllByText(/Tool call|Tool result/)[0]).toHaveTextContent("Tool call");
  });

  it("keeps the latest out-of-order result visible with its original call", () => {
    const parts: TranscriptPart[] = Array.from({ length: 10 }, (_, index) => toolCall(index + 1));

    parts.push(toolResult(1));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools (11)"));

    expect(screen.getByText("test.tool-1")).toBeInTheDocument();
    expect(screen.getByText("result-1")).toBeInTheDocument();
    expect(screen.queryByText("test.tool-2")).not.toBeInTheDocument();
    expect(screen.queryByText("test.tool-3")).not.toBeInTheDocument();
    expect(screen.getByText("Showing the latest 8 of 10 events · 9 details"))
      .toBeInTheDocument();
  });
});

describe("groupSecondaryTranscriptParts", () => {
  it("matches interleaved parallel results to the unique pending tool name", () => {
    const callA = toolCall(1);
    const callB = toolCall(2);
    const resultA = toolResult(1);
    const resultB = toolResult(2);

    expect(groupSecondaryTranscriptParts([callA, callB, resultA, resultB])).toEqual([
      [callA, resultA],
      [callB, resultB]
    ]);
  });

  it("keeps ambiguous same-name results separate instead of guessing", () => {
    const callA = toolCall(1);
    const callB = { ...toolCall(2), toolName: "tool-1" };
    const resultA = toolResult(1);
    const resultB = toolResult(1);

    expect(groupSecondaryTranscriptParts([callA, callB, resultA, resultB])).toEqual([
      [callA],
      [callB],
      [resultA],
      [resultB]
    ]);
  });

  it("keeps an unnamed result separate when several calls are pending", () => {
    const callA = toolCall(1);
    const callB = toolCall(2);
    const unnamedResult: TranscriptPart = {
      status: "unknown",
      text: "ambiguous",
      toolName: null,
      type: "tool_result"
    };

    expect(groupSecondaryTranscriptParts([callA, callB, unnamedResult])).toEqual([
      [callA],
      [callB],
      [unnamedResult]
    ]);
  });
});
