import { describe, expect, it } from "vitest";

import {
  beginInitialManagedSessionLoad,
  INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE,
  toInitialManagedSessionLoadState
} from "./helpers";

describe("initial managed session load state", () => {
  it("retains the public recovery message during an explicit retry", () => {
    expect(beginInitialManagedSessionLoad({
      kind: "error",
      message: "Safe recovery message"
    }, true)).toEqual({
      kind: "retrying",
      message: "Safe recovery message"
    });
  });

  it("retains the recovery surface while retrying a missing route session", () => {
    expect(beginInitialManagedSessionLoad({ kind: "missing" }, true)).toEqual({
      kind: "retrying",
      message: INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE
    });
  });

  it("uses the ordinary loading state for first load and resolves retry outcomes", () => {
    expect(beginInitialManagedSessionLoad({ kind: "idle" }, false)).toEqual({ kind: "loading" });
    expect(toInitialManagedSessionLoadState({ kind: "loaded", session: {} as never }))
      .toEqual({ kind: "loaded" });
    expect(toInitialManagedSessionLoadState({ kind: "error", message: "Retry failed" }))
      .toEqual({ kind: "error", message: "Retry failed" });
    expect(toInitialManagedSessionLoadState({ kind: "missing" }))
      .toEqual({ kind: "missing" });
  });
});
