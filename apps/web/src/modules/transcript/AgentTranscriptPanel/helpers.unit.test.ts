import { describe, expect, it } from "vitest";

import { buildAttachActionButtonLabel, getMarkReviewedSessionId } from "./helpers";

describe("getMarkReviewedSessionId", () => {
  it("targets the displayed session rather than a newly selected session", () => {
    expect(getMarkReviewedSessionId({
      displaySessionId: "session-visible",
      isHydratingSelection: false,
      readyForReviewAgentSessionIds: new Set(["session-visible", "session-selected"]),
      sessionCommandsEnabled: true
    })).toBe("session-visible");
  });

  it("hides the action while the selected session is hydrating", () => {
    expect(getMarkReviewedSessionId({
      displaySessionId: "session-visible",
      isHydratingSelection: true,
      readyForReviewAgentSessionIds: new Set(["session-visible"]),
      sessionCommandsEnabled: true
    })).toBeNull();
  });

  it("uses semantic access copy for a non-resumable chat", () => {
    expect(buildAttachActionButtonLabel({
      attachWaitStage: "idle",
      attaching: false,
      canResume: false,
      hasAttachedManagedSession: false,
      isOpeningSharedLiveThread: false,
      unavailableActionLabel: "Observe chat"
    })).toBe("Observe chat");
  });
});
