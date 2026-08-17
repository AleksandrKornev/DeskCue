import { describe, expect, it } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";

import {
  buildAgentChatWorkIndicator,
  buildManagedChatWorkIndicator,
  buildPendingPromptChatWorkIndicator,
  getWorkIndicatorPriority
} from "./agentChatWorkState";

function createManagedSession(
  overrides: Partial<SessionSummary> = {}
): SessionSummary {
  return {
    adapterId: "codex",
    command: "codex",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-07-27T10:00:00.000Z"
    },
    id: "managed-1",
    lastActivityAt: "2026-07-27T10:00:00.000Z",
    preview: {
      active: false,
      networkMode: "device-direct",
      artifacts: [],
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    sourceSessionId: "source-1",
    startedAt: "2026-07-27T09:00:00.000Z",
    status: "running",
    workspaceId: "workspace-1",
    workspaceName: "ExampleWorkspace",
    ...overrides
  };
}

describe("agent chat work state indicators", () => {
  it("prioritizes a pending prompt over a generic running source state", () => {
    const runningIndicator = buildAgentChatWorkIndicator({
      agentId: "codex",
      agentLabel: "Codex",
      attachMode: "resume",
      cliVersion: null,
      filePath: "codex.jsonl",
      id: "agent-1",
      model: null,
      originator: null,
      reviewedAt: null,
      source: null,
      sourceSessionId: "source-1",
      title: "Access tab e2e",
      updatedAt: "2026-07-27T10:00:00.000Z",
      workState: "running",
      workspaceName: "ExampleWorkspace",
      workspacePath: "C:\\projects\\ExampleWorkspace"
    });
    const pendingIndicator = buildPendingPromptChatWorkIndicator({
      requestedAt: "2026-07-27T10:01:00.000Z",
      sourceSessionId: "source-1",
      status: "waiting",
      text: "Check status"
    });

    expect(runningIndicator?.label).toBe("Running");
    expect(pendingIndicator?.label).toBe("Waiting");
    expect(getWorkIndicatorPriority(pendingIndicator!)).toBeGreaterThan(
      getWorkIndicatorPriority(runningIndicator!)
    );
  });

  it("does not create a waiting indicator for cancelled or unscoped prompts", () => {
    expect(
      buildPendingPromptChatWorkIndicator({
        requestedAt: "2026-07-27T10:01:00.000Z",
        sourceSessionId: "source-1",
        status: "cancelled",
        text: "Old prompt"
      })
    ).toBeNull();

    expect(
      buildPendingPromptChatWorkIndicator({
        requestedAt: "2026-07-27T10:01:00.000Z",
        status: "waiting",
        text: "Unscoped prompt"
      })
    ).toBeNull();
  });

  it("labels active managed reply phases explicitly", () => {
    expect(
      buildManagedChatWorkIndicator(
        createManagedSession({
          replyState: {
            phase: "waiting",
            promptText: "Check status",
            requestedAt: "2026-07-27T10:01:00.000Z"
          }
        })
      )?.label
    ).toBe("Waiting");

    expect(
      buildManagedChatWorkIndicator(
        createManagedSession({
          replyState: {
            phase: "sending",
            promptText: "Check status",
            requestedAt: "2026-07-27T10:01:00.000Z"
          }
        })
      )?.label
    ).toBe("Sending");
  });

  it("shows approval as the strongest managed waiting state", () => {
    expect(
      buildManagedChatWorkIndicator(
        createManagedSession({
          actionRequest: {
            command: "npm test",
            kind: "approval",
            reason: "Needs user approval",
            requestedAt: "2026-07-27T10:01:00.000Z"
          },
          replyState: {
            phase: "waiting",
            promptText: "Check status",
            requestedAt: "2026-07-27T10:01:00.000Z"
          }
        })
      )?.label
    ).toBe("Approval");
  });
});
