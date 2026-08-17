import assert from "node:assert/strict";
import test from "node:test";

import { isExternalDesktopInterruptUnavailable } from "./errors";

test("recognizes only the explicit external Desktop interrupt fallback", () => {
  assert.equal(
    isExternalDesktopInterruptUnavailable({
      code: "external_desktop_interrupt_unavailable",
      error: "DeskCue cannot interrupt this Codex Desktop chat directly."
    }),
    true
  );
  assert.equal(isExternalDesktopInterruptUnavailable({ error: "Request failed" }), false);
  assert.equal(isExternalDesktopInterruptUnavailable({ code: "not_accepting_input" }), false);
});
