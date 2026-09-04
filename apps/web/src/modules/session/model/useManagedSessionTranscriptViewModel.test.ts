import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionDetail } from "@deskcue/protocol";

import {
  readAgentReportedDiffProjection,
  readManagedSessionActivityGroups
} from "./transcript/helpers";

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

  it("keeps only exact unique agent-reported diffs", () => {
    const exactDiff = {
      additions: 1,
      changeType: "update" as const,
      deletions: 0,
      filePath: "src/app.ts",
      text: "+const ready = true;",
      title: "src/app.ts",
      type: "diff" as const
    };

    const transcript = [
      {
        id: "compact-change",
        isCompact: true,
        phase: null,
        role: "tool" as const,
        text: "Changes hidden in live view",
        timestamp: "2026-07-30T01:20:00.000Z",
        parts: [{
          ...exactDiff,
          text: "[diff hidden in live view]"
        }]
      },
      {
        id: "summary-change",
        phase: null,
        role: "tool" as const,
        text: "Changed src/old.ts",
        timestamp: "2026-07-30T01:21:00.000Z",
        parts: [{
          ...exactDiff,
          filePath: "src/old.ts",
          text: "[diff hidden in live view]",
          title: "src/old.ts"
        }]
      },
      {
        id: "exact-change",
        phase: null,
        role: "tool" as const,
        text: "Changed src/app.ts",
        timestamp: "2026-07-30T01:22:00.000Z",
        parts: [exactDiff]
      },
      {
        id: "duplicate-change",
        phase: null,
        role: "tool" as const,
        text: "Changed src/app.ts again",
        timestamp: "2026-07-30T01:23:00.000Z",
        parts: [exactDiff]
      }
    ] satisfies AgentSessionDetail["transcript"];

    assert.deepEqual(readAgentReportedDiffProjection(transcript), {
      detailsUnavailable: true,
      parts: [exactDiff]
    });
  });

  it("does not collapse distinct diffs containing null characters", () => {
    const buildEntry = (
      id: string,
      title: string,
      text: string
    ): AgentSessionDetail["transcript"][number] => ({
      id,
      phase: null,
      role: "tool",
      text: `Changed ${title}`,
      timestamp: "2026-07-30T01:22:00.000Z",
      parts: [{
        additions: 1,
        changeType: "update",
        deletions: 0,
        filePath: "src/app.ts",
        text,
        title,
        type: "diff"
      }]
    });
    const transcript = [
      buildEntry("first", "left", "right\0tail"),
      buildEntry("second", "left\0right", "tail")
    ];

    assert.equal(readAgentReportedDiffProjection(transcript).parts.length, 2);
  });

  it("marks exact tail diffs partial while older transcript history remains", () => {
    const transcript = [{
      id: "tail-change",
      phase: null,
      role: "tool" as const,
      text: "Changed src/app.ts",
      timestamp: "2026-07-30T01:22:00.000Z",
      parts: [{
        additions: 1,
        changeType: "update" as const,
        deletions: 0,
        filePath: "src/app.ts",
        text: "+const ready = true;",
        title: "src/app.ts",
        type: "diff" as const
      }]
    }] satisfies AgentSessionDetail["transcript"];

    assert.deepEqual(readAgentReportedDiffProjection(transcript, true), {
      detailsUnavailable: true,
      parts: transcript[0].parts
    });
  });
});
