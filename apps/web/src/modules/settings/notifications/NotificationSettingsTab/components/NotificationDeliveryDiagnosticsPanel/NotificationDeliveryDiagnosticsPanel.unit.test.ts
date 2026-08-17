import { describe, expect, it } from "vitest";

import type { NotificationDeliveryAttemptDiagnostic } from "@deskcue/protocol";

import { isFailureUnresolved } from "./helpers";

function createAttempt(
  provider: NotificationDeliveryAttemptDiagnostic["provider"],
  completedAt: string
): NotificationDeliveryAttemptDiagnostic {
  return {
    attempt: 1,
    attemptedAt: completedAt,
    completedAt,
    delivered: 1,
    event: "agent.turn.finished",
    failed: 0,
    maxAttempts: 1,
    provider,
    status: "delivered",
    tag: "test"
  };
}

describe("isFailureUnresolved", () => {
  it("treats a later delivery by the same provider as recovery", () => {
    const failure = {
      ...createAttempt("telegram", "2026-08-04T10:00:00.000Z"),
      error: "Telegram request timed out",
      failed: 1,
      status: "uncertain" as const
    };
    const success = createAttempt("telegram", "2026-08-04T10:01:00.000Z");

    expect(isFailureUnresolved(failure, success)).toBe(false);
  });

  it("keeps a failure visible when a different provider succeeds", () => {
    const failure = {
      ...createAttempt("telegram", "2026-08-04T10:00:00.000Z"),
      error: "Telegram request timed out",
      failed: 1,
      status: "uncertain" as const
    };
    const success = createAttempt("web_push", "2026-08-04T10:01:00.000Z");

    expect(isFailureUnresolved(failure, success)).toBe(true);
  });
});
