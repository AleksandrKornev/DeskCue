import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectBackendWaitingDetailEntry } from "./waiting/selectBackendWaitingDetailEntry";

const timestamp = "2026-07-30T12:00:00.000Z";

describe("selectBackendWaitingDetailEntry", () => {
  it("keeps only commentary details in the waiting block", () => {
    const entry = {
      id: "detail-1",
      role: "commentary",
      timestamp,
      text: "I am checking the current state",
      phase: null,
      parts: []
    } as Parameters<typeof selectBackendWaitingDetailEntry>[0];

    assert.equal(selectBackendWaitingDetailEntry(entry, timestamp), entry);
  });

  it("keeps the waiting spinner for tool and system transcript entries", () => {
    for (const role of ["tool", "system"] as const) {
      const entry = {
        id: `${role}-1`,
        role,
        timestamp,
        text: "internal activity",
        phase: null,
        parts: []
      } as Parameters<typeof selectBackendWaitingDetailEntry>[0];

      assert.equal(selectBackendWaitingDetailEntry(entry, timestamp), null);
    }
  });
});
