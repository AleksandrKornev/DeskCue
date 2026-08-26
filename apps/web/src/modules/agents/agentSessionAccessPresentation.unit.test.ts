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
  it("does not attribute a running Codex turn to Desktop without source evidence", () => {
    const presentation = getUnavailableChatPresentation(createSession({ workState: "running" }));

    expect(presentation.capabilityLabel).toBe("Active outside DeskCue");
    expect(presentation.actionLabel).toBe("Observe chat");
    expect(presentation.description).toContain("sending stays disabled while this turn is active");
  });

  it("does not attribute a Codex CLI turn to Desktop", () => {
    const presentation = getUnavailableChatPresentation(createSession({
      originator: "codex_cli_rs",
      workState: "running"
    }));

    expect(presentation.capabilityLabel).toBe("Active outside DeskCue");
    expect(presentation.description).not.toContain("Codex Desktop");
  });

  it("names Codex Desktop only when the source metadata confirms it", () => {
    const presentation = getUnavailableChatPresentation(createSession({
      originator: "Codex Desktop",
      workState: "running"
    }));

    expect(presentation.capabilityLabel).toBe("Active in Codex Desktop");
    expect(presentation.hint).toBe("The current turn stays controlled by Codex Desktop");
  });

  it("uses runtime-neutral wording for another source agent", () => {
    const presentation = getUnavailableChatPresentation(createSession({
      agentId: "claude-code",
      agentLabel: "Claude Code",
      workState: "running"
    }));

    expect(presentation.capabilityLabel).toBe("Active outside DeskCue");
    expect(presentation.description).not.toContain("Codex");
  });

  it("identifies an idle non-resumable chat as view only", () => {
    const presentation = getUnavailableChatPresentation(createSession());

    expect(presentation.capabilityLabel).toBe("View only");
    expect(presentation.actionLabel).toBe("Open view-only chat");
  });
});
