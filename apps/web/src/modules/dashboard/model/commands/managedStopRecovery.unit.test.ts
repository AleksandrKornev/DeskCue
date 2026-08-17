import { describe, expect, it, vi } from "vitest";

import {
  isCloudControlReceipt,
  recoverStoppedManagedSession
} from "./managedStopRecovery";

describe("managed stop recovery", () => {
  it("recognizes only the exact replay receipt", () => {
    expect(isCloudControlReceipt({ accepted: true, sessionId: "session-1" }, "session-1"))
      .toBe(true);
    expect(isCloudControlReceipt({ accepted: true, sessionId: "session-1", extra: true }, "session-1"))
      .toBe(false);
    expect(isCloudControlReceipt({ accepted: true, sessionId: "session-2" }, "session-1"))
      .toBe(false);
  });

  it("confirms an ambiguous stop only after forced hydration observes stopped", async () => {
    const stopped = { id: "session-1", status: "stopped" };
    const loadSession = vi.fn().mockResolvedValue(stopped);

    await expect(recoverStoppedManagedSession("session-1", loadSession as never))
      .resolves.toBe(stopped);
    expect(loadSession).toHaveBeenCalledWith("session-1", { force: true, silent: true });

    loadSession.mockResolvedValue({ id: "session-1", status: "running" });
    await expect(recoverStoppedManagedSession("session-1", loadSession as never))
      .resolves.toBeNull();
  });
});
