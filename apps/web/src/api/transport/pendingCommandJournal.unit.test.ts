import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand,
  clearPendingCloudCommandForResult
} from "./pendingCommandJournal";

const STORAGE_KEY = "deskcue.pendingCloudCommands.v1";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;

describe("pending Cloud command journal", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
  });

  it("survives a simulated new tab or reload without storing payload plaintext", () => {
    const payloadMarker = "fixture-payload-marker";
    const first = acquirePendingCloudCommand("managed.input", "session-1", payloadMarker);
    sessionStorage.setItem(STORAGE_KEY, "tab-local-noise");
    sessionStorage.clear();
    resetDeskCueRuntimeForTests();
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const retried = acquirePendingCloudCommand("managed.input", "session-1", payloadMarker);

    expect(retried.commandId).toBe(first.commandId);
    expect(first.fingerprint).toBe(createHash("sha256")
      .update(`cloud-machine:machine-1\u0000managed.input\u0000session-1\u0000${payloadMarker}`)
      .digest("hex"));
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(payloadMarker);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("uses a new command id when the prompt changes or the prior command is complete", () => {
    const first = acquirePendingCloudCommand("managed.input", "session-1", "first prompt");
    const changed = acquirePendingCloudCommand("managed.input", "session-1", "second prompt");
    expect(changed.commandId).not.toBe(first.commandId);

    clearPendingCloudCommand(first);
    const completedRetry = acquirePendingCloudCommand("managed.input", "session-1", "first prompt");
    expect(completedRetry.commandId).not.toBe(first.commandId);
  });

  it("does not resurrect a command removed by another tab", () => {
    const first = acquirePendingCloudCommand(
      "managed.input",
      "session-cross-tab",
      "shared prompt"
    );

    // The storage event is delivered to other documents, not the tab that made
    // the change. Reading storage itself must therefore detect the external
    // deletion instead of merging the stale in-memory mirror back into it.
    localStorage.removeItem(STORAGE_KEY);
    const afterExternalCompletion = acquirePendingCloudCommand(
      "managed.input",
      "session-cross-tab",
      "shared prompt"
    );

    expect(afterExternalCompletion.commandId).not.toBe(first.commandId);
  });

  it("uses a new command id after an explicit recovery resend clears the ambiguous command", () => {
    const original = acquirePendingCloudCommand(
      "managed.input",
      "session-recovery",
      "possibly delivered prompt"
    );
    const ambiguousRetry = acquirePendingCloudCommand(
      "managed.input",
      "session-recovery",
      "possibly delivered prompt"
    );
    expect(ambiguousRetry.commandId).toBe(original.commandId);

    clearPendingCloudCommand(ambiguousRetry);
    const explicitResend = acquirePendingCloudCommand(
      "managed.input",
      "session-recovery",
      "possibly delivered prompt"
    );
    expect(explicitResend.commandId).not.toBe(original.commandId);
  });

  it("reuses an ambiguous command id in memory when persistent storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("Storage denied", "SecurityError");
      });
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage denied", "SecurityError");
      });

    try {
      const first = acquirePendingCloudCommand(
        "managed.input",
        "session-storage-denied",
        "ambiguous prompt"
      );
      const retried = acquirePendingCloudCommand(
        "managed.input",
        "session-storage-denied",
        "ambiguous prompt"
      );

      expect(retried.commandId).toBe(first.commandId);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("expires a stale command id after the seven-day daemon receipt window", () => {
    const first = acquirePendingCloudCommand("managed.interrupt", "session-1", "", 1_000);
    const expired = acquirePendingCloudCommand(
      "managed.interrupt",
      "session-1",
      "",
      1_000 + SEVEN_DAYS_MS + 1
    );
    expect(expired.commandId).not.toBe(first.commandId);
  });

  it("keeps the journal bounded to the newest 64 commands", () => {
    for (let index = 0; index < 70; index += 1) {
      acquirePendingCloudCommand("managed.interrupt", `session-${index}`, "", index + 1);
    }
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as object;
    expect(Object.keys(stored)).toHaveLength(64);
  });

  it.each([
    "source.attach",
    "managed.input",
    "managed.interrupt",
    "managed.stop",
    "preview.configure",
    "preview.stop"
  ] as const)(
    "clears %s after a definitive daemon 4xx result",
    (operation) => {
      const first = acquirePendingCloudCommand(operation, "target-1", "fixture-input");
      expect(clearPendingCloudCommandForResult(first, {
        data: { error: "terminal_fixture" },
        ok: false,
        status: 422
      })).toBe(true);
      const retried = acquirePendingCloudCommand(operation, "target-1", "fixture-input");
      expect(retried.commandId).not.toBe(first.commandId);
    }
  );

  it.each([
    { data: { error: "network_fixture" }, ok: false, status: null },
    { data: { error: "timeout_fixture" }, ok: false, status: 408 },
    { data: { error: "overload_fixture" }, ok: false, status: 429 },
    { data: { error: "server_fixture" }, ok: false, status: 503 },
    { data: { error: "remote_control_outcome_unknown" }, ok: false, status: 409 }
  ])("retains the command id for a retryable or ambiguous result", (result) => {
    const first = acquirePendingCloudCommand("managed.input", "session-1", "fixture-input");
    expect(clearPendingCloudCommandForResult(first, result)).toBe(false);
    const retried = acquirePendingCloudCommand("managed.input", "session-1", "fixture-input");
    expect(retried.commandId).toBe(first.commandId);
  });
});
