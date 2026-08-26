import { describe, expect, it, vi } from "vitest";

import {
  resendRecoveredPrompt,
  resolveRecoveredPromptCommandTarget
} from "./promptRecoveryAction";

describe("resolveRecoveredPromptCommandTarget", () => {
  it("clears the source attach fingerprint for a detached Codex retry", () => {
    expect(resolveRecoveredPromptCommandTarget("managed-1", {
      adapterId: "codex",
      canSendInput: false,
      sourceSessionId: "source-1"
    })).toEqual({
      operation: "source.attach",
      targetId: "codex:source-1"
    });
  });

  it("uses the managed input fingerprint for an attached session", () => {
    expect(resolveRecoveredPromptCommandTarget("managed-1", {
      adapterId: "codex",
      canSendInput: true,
      sourceSessionId: "source-1"
    })).toEqual({
      operation: "managed.input",
      targetId: "managed-1"
    });
  });
});

describe("resendRecoveredPrompt", () => {
  it("retries a definitely-not-sent prompt", async () => {
    const clearPendingCommand = vi.fn();
    const sendInput = vi.fn(() => Promise.resolve(true));

    await expect(resendRecoveredPrompt({
      clearPendingCommand,
      promptRecovery: {
        phase: "not_sent",
        promptText: " safe retry ",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: true
      },
      sendInput
    })).resolves.toBe(true);

    expect(clearPendingCommand).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("safe retry");
    expect(clearPendingCommand.mock.invocationCallOrder[0]).toBeLessThan(
      sendInput.mock.invocationCallOrder[0]
    );
  });

  it("does not attempt to resend a prompt with an unknown outcome", async () => {
    const clearPendingCommand = vi.fn();
    const sendInput = vi.fn(() => Promise.resolve(true));

    await expect(resendRecoveredPrompt({
      clearPendingCommand,
      promptRecovery: {
        phase: "outcome_unknown",
        promptText: "possibly delivered",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      },
      sendInput
    })).resolves.toBe(false);

    expect(clearPendingCommand).not.toHaveBeenCalled();
    expect(sendInput).not.toHaveBeenCalled();
  });
});
