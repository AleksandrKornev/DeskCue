import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConversationTimelineItem } from "@modules/session/types";

import { orderConversationActivityRuns } from "./timelineActivityRuns";

function toolsActivity(
  key: string,
  start: number,
  end: number
): Extract<ConversationTimelineItem, { type: "activity" }> {
  const sourceEntryCount = end - start + 1;

  return {
    activity: {
      entries: [],
      entryIds: [],
      id: key,
      kind: "tools",
      label: `Tools (${sourceEntryCount})`,
      sourceEntryCount,
      sourceEntryRanges: [{
        end,
        prefix: "session-",
        start
      }],
      timestamp: "2026-09-02T10:38:00.000Z"
    },
    key,
    type: "activity"
  };
}

describe("orderConversationActivityRuns", () => {
  it("counts overlapping tool activity windows by unique source entry", () => {
    const firstWindow = toolsActivity("tools:first", 1, 34);
    const secondWindow = toolsActivity("tools:second", 3, 37);

    const ordered = orderConversationActivityRuns([firstWindow, secondWindow]);
    const tools = ordered[0];

    assert.equal(ordered.length, 1);
    assert.equal(tools?.type, "activity");
    assert.equal(tools?.activity.label, "Tools (37)");
    assert.equal(tools?.activity.sourceEntryCount, 37);
    assert.deepEqual(tools?.activity.sourceEntryRanges, [{
      end: 37,
      prefix: "session-",
      start: 1
    }]);
  });
});
