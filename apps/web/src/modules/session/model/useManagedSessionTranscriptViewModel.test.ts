import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionDetail } from "@deskcue/protocol";

import { readManagedSessionActivityGroups } from "./transcript/helpers";

describe("managed session transcript view model", () => {
  it("uses activity groups embedded in transcript view messages", () => {
    const activity = {
      entries: [],
      entryIds: ["entry-1", "entry-2", "entry-3"],
      id: "details-1",
      kind: "details" as const,
      label: "Details (3)",
      sourceEntryIds: ["entry-1", "entry-2", "entry-3"],
      timestamp: "2026-07-30T01:22:00.000Z"
    };
    const view = {
      items: [
        {
          activities: [activity],
          changeActivities: [],
          entry: {
            id: "assistant-1",
            phase: null,
            role: "assistant" as const,
            text: "Done",
            timestamp: "2026-07-30T01:23:00.000Z"
          },
          id: "assistant-1",
          type: "message" as const
        }
      ],
      latestWaitingDetailEntry: null,
      sessionId: "codex:session-1",
      updatedAt: "2026-07-30T01:23:00.000Z"
    } as unknown as NonNullable<AgentSessionDetail["transcriptView"]>;

    assert.deepEqual(readManagedSessionActivityGroups(view, []), [activity]);
  });

  it("deduplicates repeated groups from a delta transcript view", () => {
    const activity = {
      entries: [],
      entryIds: ["tool-1", "tool-2"],
      id: "tools-1",
      kind: "tools" as const,
      label: "Tools (2)",
      timestamp: "2026-07-30T01:22:00.000Z"
    };
    const view = {
      items: [
        { activity, id: "tools-1", type: "activity" as const },
        { activity, id: "tools-1-repeat", type: "activity" as const }
      ],
      latestWaitingDetailEntry: null,
      sessionId: "codex:session-1",
      updatedAt: "2026-07-30T01:23:00.000Z"
    } as unknown as NonNullable<AgentSessionDetail["transcriptView"]>;

    assert.equal(readManagedSessionActivityGroups(view, []).length, 1);
  });
});
