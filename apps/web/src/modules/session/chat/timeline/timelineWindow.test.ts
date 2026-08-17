import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConversationTimelineItem } from "@modules/session/types";

import { mergeRetainedConversationTimeline } from "./timelineWindow";

function message(
  key: string,
  text: string,
  phase: string | null = "complete",
  role: "assistant" | "user" = "assistant"
): Extract<ConversationTimelineItem, { type: "message" }> {
  return {
    activities: [],
    changeActivities: [],
    continued: false,
    entry: {
      id: key,
      phase,
      role,
      text,
      timestamp: "2026-08-03T16:10:00.000Z"
    },
    key,
    role,
    timestamp: "2026-08-03T16:10:00.000Z",
    turnStatus: null,
    type: "message"
  };
}

function modelActivity(
  key: string,
  sourceEntryId: string,
  timestamp: string,
  detail: string
): Extract<ConversationTimelineItem, { type: "activity" }> {
  const entry = {
    id: `${key}:entry`,
    parts: [{ detail, label: "Model changed", type: "status" as const }],
    phase: "model_changed",
    role: "system" as const,
    text: `Model changed to ${detail.split(" -> ").at(-1)}`,
    timestamp
  };

  return {
    activity: {
      entries: [entry],
      entryIds: [entry.id],
      id: key,
      kind: "model",
      label: "Model changed",
      sourceEntryCount: 1,
      sourceEntryIds: [sourceEntryId],
      timestamp
    },
    key,
    type: "activity"
  };
}

describe("mergeRetainedConversationTimeline", () => {
  it("drops an obsolete in-progress streaming projection when the final message arrives", () => {
    const pending = message("local-llm:pending:chat-1", "DESKCUE", "in_progress");
    const final = message("local-llm:assistant-1", "DESKCUE_FINAL_OK");

    const merged = mergeRetainedConversationTimeline([pending], [final]);

    assert.equal(merged.filter((item) => item.type === "message").length, 1);
    assert.equal(merged.some((item) => item.type === "message" && item.key === pending.key), false);
    assert.equal(merged.some((item) => item.type === "message" && item.key === final.key), true);
  });

  it("still retains a complete item missing from a partial source tail", () => {
    const retained = message("assistant-older", "An earlier complete answer");
    const current = message("assistant-newer", "The newest answer");

    const merged = mergeRetainedConversationTimeline([retained], [current]);

    assert.equal(merged.filter((item) => item.type === "message").length, 2);
  });

  it("keeps the author label for each consecutive user prompt", () => {
    const first = message("user-first", "First prompt", "complete", "user");
    const second = message("user-second", "Replacement prompt", "complete", "user");

    const merged = mergeRetainedConversationTimeline([first], [second]);
    const messages = merged.filter(
      (item): item is Extract<ConversationTimelineItem, { type: "message" }> =>
        item.type === "message"
    );

    assert.equal(messages[0]?.continued, false);
    assert.equal(messages[1]?.continued, false);
  });

  it("dedupes the same model transition across changing hydration source ids", () => {
    const timestamp = "2026-08-03T16:10:00.000Z";
    const retained = modelActivity(
      "model:window",
      "session@2048-42",
      timestamp,
      "GPT-5.6 Terra -> GPT-5.6 Sol"
    );
    const current = modelActivity(
      "model:full",
      "session-22088",
      timestamp,
      "GPT-5.6 Terra -> GPT-5.6 Sol"
    );

    const merged = mergeRetainedConversationTimeline([retained], [current]);
    const modelActivities = merged.filter(
      (item): item is Extract<ConversationTimelineItem, { type: "activity" }> =>
        item.type === "activity" && item.activity.kind === "model"
    );

    assert.equal(modelActivities.length, 1);
    assert.equal(modelActivities[0]?.activity.label, "Model changed");
    assert.equal(modelActivities[0]?.key, current.key);
  });

  it("keeps distinct model transitions even when they are adjacent", () => {
    const first = modelActivity(
      "model:first",
      "session-1",
      "2026-08-03T16:10:00.000Z",
      "GPT-5.6 Terra -> GPT-5.6 Sol"
    );
    const second = modelActivity(
      "model:second",
      "session-2",
      "2026-08-03T16:11:00.000Z",
      "GPT-5.6 Sol -> GPT-5.6 Terra"
    );

    const merged = mergeRetainedConversationTimeline([first], [second]);
    const modelActivities = merged.filter(
      (item): item is Extract<ConversationTimelineItem, { type: "activity" }> =>
        item.type === "activity" && item.activity.kind === "model"
    );

    assert.equal(modelActivities.length, 1);
    assert.equal(modelActivities[0]?.activity.label, "Model changed (2)");
    assert.equal(modelActivities[0]?.activity.entries.length, 2);
  });

  it("does not recount a retained model transition when the current group grows", () => {
    const retained = modelActivity(
      "model:retained",
      "session@2048-42",
      "2026-08-03T16:10:00.000Z",
      "GPT-5.6 Terra -> GPT-5.6 Sol"
    );
    const firstCurrent = modelActivity(
      "model:current-first",
      "session-22088",
      "2026-08-03T16:10:00.000Z",
      "GPT-5.6 Terra -> GPT-5.6 Sol"
    );
    const secondCurrent = modelActivity(
      "model:current-second",
      "session-22120",
      "2026-08-03T16:11:00.000Z",
      "GPT-5.6 Sol -> GPT-5.6 Terra"
    );
    const currentGroup: Extract<ConversationTimelineItem, { type: "activity" }> = {
      activity: {
        ...firstCurrent.activity,
        entries: [firstCurrent.activity.entries[0], secondCurrent.activity.entries[0]],
        entryIds: [
          firstCurrent.activity.entries[0].id,
          secondCurrent.activity.entries[0].id
        ],
        label: "Model changed (2)",
        sourceEntryCount: 2,
        sourceEntryIds: ["session-22088", "session-22120"]
      },
      key: "model:current-group",
      type: "activity"
    };

    const merged = mergeRetainedConversationTimeline([retained], [currentGroup]);
    const modelActivities = merged.filter(
      (item): item is Extract<ConversationTimelineItem, { type: "activity" }> =>
        item.type === "activity" && item.activity.kind === "model"
    );

    assert.equal(modelActivities.length, 1);
    assert.equal(modelActivities[0]?.activity.label, "Model changed (2)");
    assert.equal(modelActivities[0]?.activity.entries.length, 2);
  });
});
