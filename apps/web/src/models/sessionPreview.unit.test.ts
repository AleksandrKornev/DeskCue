import { describe, expect, it } from "vitest";

import {
  isCurrentDeskCuePreviewPort,
  parsePreviewPort,
  resolvePreviewOwner
} from "./sessionPreview";

describe("session preview location helpers", () => {
  it("accepts only decimal ports inside the transport range", () => {
    expect(parsePreviewPort("5173")).toEqual({ ok: true, port: 5173 });
    expect(parsePreviewPort("", 3000)).toEqual({ ok: true, port: 3000 });
    expect(parsePreviewPort("")).toEqual({ ok: true, port: null });
    expect(parsePreviewPort("Infinity")).toEqual({ ok: false });
    expect(parsePreviewPort("1.5")).toEqual({ ok: false });
    expect(parsePreviewPort("0x50")).toEqual({ ok: false });
    expect(parsePreviewPort("0")).toEqual({ ok: false });
    expect(parsePreviewPort("65536")).toEqual({ ok: false });
  });

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
