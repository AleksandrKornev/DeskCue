import { describe, expect, it } from "vitest";

import { selectBackendWaitingDetailEntry } from "./selectBackendWaitingDetailEntry";

const WAITING_SINCE = "2026-08-23T18:00:00.000Z";

function buildCommentaryEntry(text: string) {
  return {
    id: "commentary-1",
    phase: "commentary" as const,
    role: "commentary" as const,
    text,
    timestamp: "2026-08-23T18:00:01.000Z"
  };
}

describe("selectBackendWaitingDetailEntry", () => {
  it("keeps the waiting fallback instead of selecting an empty commentary entry", () => {
    expect(selectBackendWaitingDetailEntry(buildCommentaryEntry("   "), WAITING_SINCE)).toBeNull();
  });

  it("selects a fresh commentary entry with visible text", () => {
    const entry = buildCommentaryEntry("Checking the current session state");

    expect(selectBackendWaitingDetailEntry(entry, WAITING_SINCE)).toBe(entry);
  });
});
