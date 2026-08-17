import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConversationActivity } from "@modules/session/types";

import { readManagedSessionActivityExpansionKey } from "./activity/helpers";
import { readActivityHydrationEntryIds } from "./useManagedSessionActivityEntryHydration";

function createActivity(
  overrides: Partial<ConversationActivity>
): ConversationActivity {
  return {
    entries: [],
    id: "tools",
    kind: "tools",
    label: "Tools",
    timestamp: "2026-07-26T10:00:00.000Z",
    ...overrides
  };
}

describe("managed session activity expansion", () => {
  it("keeps append-growing source ranges on one expansion key", () => {
    const first = createActivity({
      id: "tools-old",
      sourceEntryRanges: [{ end: 12, prefix: "entry-", start: 10 }]
    });
    const appended = createActivity({
      id: "tools-new",
      sourceEntryRanges: [{ end: 24, prefix: "entry-", start: 10 }]
    });

    assert.equal(
      readManagedSessionActivityExpansionKey(first),
      readManagedSessionActivityExpansionKey(appended)
    );
  });

  it("falls back to first source entry id before volatile group id", () => {
    assert.equal(
      readManagedSessionActivityExpansionKey(createActivity({
        id: "tools-new",
        sourceEntryIds: ["entry-10", "entry-11"]
      })),
      "tools:entry:entry-10"
    );
  });

  it("hydrates the newest entries from an append-growing activity range", () => {
    const activity = createActivity({
      sourceEntryRanges: [{ end: 24, prefix: "entry-", start: 10 }]
    });

    assert.deepEqual(
      readActivityHydrationEntryIds(activity, 3),
      ["entry-22", "entry-23", "entry-24"]
    );
  });
});
