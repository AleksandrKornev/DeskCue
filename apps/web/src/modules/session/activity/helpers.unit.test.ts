import { describe, expect, it } from "vitest";

import type { ChatTranscriptEntry } from "@modules/session/types";

import { isCompactSummaryEntry } from "./helpers";

function compactStatusEntry(detail: string): ChatTranscriptEntry {
  return {
    id: `entry:${detail}`,
    isCompact: true,
    parts: [{ detail, label: "Tool events", type: "status" }],
    phase: null,
    role: "tool",
    text: "Tool entry hidden in live view",
    timestamp: "2026-09-02T10:38:00.000Z"
  };
}

describe("isCompactSummaryEntry", () => {
  it("recognizes singular and plural compact activity placeholders", () => {
    expect(isCompactSummaryEntry(compactStatusEntry(
      "1 tool entry loads when this activity is opened"
    ))).toBe(true);
    expect(isCompactSummaryEntry(compactStatusEntry(
      "3 tool entries load when this activity is opened"
    ))).toBe(true);
  });

  it("does not hide an ordinary compact status", () => {
    expect(isCompactSummaryEntry(compactStatusEntry(
      "Tool entry loaded after this activity was opened"
    ))).toBe(false);
  });
});
