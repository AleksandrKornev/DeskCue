import { describe, expect, it } from "vitest";

import {
  isCurrentDeskCuePreviewPort,
  resolvePreviewOwner
} from "./sessionPreview";

describe("session preview location helpers", () => {
  it("uses the explicitly supplied browser location", () => {
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 4321 }
    } as never;

    expect(resolvePreviewOwner(session)).toEqual({
      kind: "session",
      ownerId: "session-1"
    });
    expect(isCurrentDeskCuePreviewPort(4100, {
      port: "4100",
      protocol: "http:"
    })).toBe(true);
  });

  it("uses the local chat preview proxy for DeskCue-owned runtimes", () => {
    const session = {
      id: "local-llm-session:chat-1",
      preview: { active: true, networkMode: "device-direct", port: 4321 }
    } as never;

    expect(resolvePreviewOwner(session)).toEqual({
      kind: "local-llm",
      ownerId: "chat-1"
    });
  });
});
