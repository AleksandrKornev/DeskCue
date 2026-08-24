import { describe, expect, it } from "vitest";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { getUnavailableChatPresentation } from "./agentSessionAccessPresentation";

function createSession(patch: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "read_only",
    cliVersion: null,
    filePath: "thread.jsonl",
    id: "codex:thread-1",
    model: null,
    originator: null,
    source: null,
    sourceSessionId: "thread-1",
    title: "Thread",
    updatedAt: "2026-08-23T00:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState: "idle",
    ...patch
  };
}

describe("agent session access presentation", () => {
  it("identifies a running Codex turn as an observation view", () => {
    const presentation = getUnavailableChatPresentation(createSession({ workState: "running" }));

    expect(presentation.capabilityLabel).toBe("Active in Codex Desktop");
    expect(presentation.actionLabel).toBe("Observe chat");
    expect(presentation.description).toContain("sending stays disabled while this turn is active");
  });

  it("identifies an idle non-resumable chat as view only", () => {
    const presentation = getUnavailableChatPresentation(createSession());

    expect(presentation.capabilityLabel).toBe("View only");
    expect(presentation.actionLabel).toBe("Open view-only chat");
  });
});
