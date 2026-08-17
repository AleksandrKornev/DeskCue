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
  it("retries a definitely-not-sent prompt without a duplicate-work confirmation", async () => {
    const clearPendingCommand = vi.fn();
    const confirmDuplicate = vi.fn(() => Promise.resolve(false));
    const sendInput = vi.fn(() => Promise.resolve(true));

    await expect(resendRecoveredPrompt({
      clearPendingCommand,
      confirmDuplicate,
      promptRecovery: {
        phase: "not_sent",
        promptText: " safe retry ",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: true
      },
      sendInput
    })).resolves.toBe(true);

    expect(confirmDuplicate).not.toHaveBeenCalled();
    expect(clearPendingCommand).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("safe retry");
    expect(clearPendingCommand.mock.invocationCallOrder[0]).toBeLessThan(
      sendInput.mock.invocationCallOrder[0]
    );
  });

  it("does nothing when sending again after an unknown outcome is cancelled", async () => {
    const clearPendingCommand = vi.fn();
    const confirmDuplicate = vi.fn(() => Promise.resolve(false));
    const sendInput = vi.fn(() => Promise.resolve(true));

    await expect(resendRecoveredPrompt({
      clearPendingCommand,
      confirmDuplicate,
      promptRecovery: {
        phase: "outcome_unknown",
        promptText: "possibly delivered",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      },
      sendInput
    })).resolves.toBe(false);

    expect(confirmDuplicate).toHaveBeenCalledTimes(1);
    expect(clearPendingCommand).not.toHaveBeenCalled();
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("clears the ambiguous command before explicitly sending it again", async () => {
    const clearPendingCommand = vi.fn();
    const confirmDuplicate = vi.fn(() => Promise.resolve(true));
    const sendInput = vi.fn(() => Promise.resolve(true));

    await expect(resendRecoveredPrompt({
      clearPendingCommand,
      confirmDuplicate,
      promptRecovery: {
        phase: "outcome_unknown",
        promptText: "possibly delivered",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      },
      sendInput
    })).resolves.toBe(true);

    expect(clearPendingCommand).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("possibly delivered");
    expect(clearPendingCommand.mock.invocationCallOrder[0]).toBeLessThan(
      sendInput.mock.invocationCallOrder[0]
    );
  });
});
