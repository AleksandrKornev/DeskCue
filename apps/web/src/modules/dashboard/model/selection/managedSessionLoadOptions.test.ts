import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MANAGED_SESSION_DEBUG_LOG_TAIL } from "@modules/dashboard/model/data/dashboardConstants";

import { buildManagedSessionLoadOptionsForTab } from "./managedSessionLoadOptions";

describe("managed session load options", () => {
  it("uses compact chat view outside Debug and Diff", () => {
    assert.deepEqual(
      buildManagedSessionLoadOptionsForTab("overview", { silent: true }),
      {
        sessionView: "chat",
        silent: true
      }
    );
    assert.deepEqual(
      buildManagedSessionLoadOptionsForTab("activity", { silent: true }),
      {
        sessionView: "chat",
        silent: true
      }
    );
    assert.deepEqual(
      buildManagedSessionLoadOptionsForTab("preview", { silent: true }),
      {
        sessionView: "chat",
        silent: true
      }
    );
  });

  it("uses bounded debug view for Debug", () => {
    assert.deepEqual(
      buildManagedSessionLoadOptionsForTab("logs", { silent: true }),
      {
        debugLogTail: MANAGED_SESSION_DEBUG_LOG_TAIL,
        sessionView: "debug",
        silent: true
      }
    );
  });

  it("uses diff view for Diff", () => {
    assert.deepEqual(
      buildManagedSessionLoadOptionsForTab("diff", { silent: true }),
      {
        sessionView: "diff",
        silent: true
      }
    );
  });
});
