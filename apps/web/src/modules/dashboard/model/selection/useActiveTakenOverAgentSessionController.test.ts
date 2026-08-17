import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldShowActiveTakenOverAgentSessionLoading } from "./helpers";

describe("active taken-over agent session controller", () => {
  it("keeps visible chat mounted during background refresh", () => {
    assert.equal(
      shouldShowActiveTakenOverAgentSessionLoading("refreshing", true),
      false
    );
  });

  it("shows loading for initial refresh without a visible session", () => {
    assert.equal(
      shouldShowActiveTakenOverAgentSessionLoading("refreshing", false),
      true
    );
    assert.equal(
      shouldShowActiveTakenOverAgentSessionLoading("loading", false),
      true
    );
  });
});
