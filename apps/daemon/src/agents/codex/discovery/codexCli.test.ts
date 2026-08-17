import assert from "node:assert/strict";
import test from "node:test";

import { chooseCodexModel } from "./codexCli.ts";

test("keeps the resumed Codex session model ahead of the global Codex default", () => {
  assert.equal(
    chooseCodexModel({
      configuredModel: "gpt-global-default",
      sessionModel: " gpt-session-model "
    }),
    "gpt-session-model"
  );
});

test("keeps the explicit DeskCue Codex model override highest priority", () => {
  assert.equal(
    chooseCodexModel({
      configuredModel: "gpt-global-default",
      overrideModel: "gpt-explicit-override",
      sessionModel: "gpt-session-model"
    }),
    "gpt-explicit-override"
  );
});

test("falls back to the global Codex default when the session has no model", () => {
  assert.equal(
    chooseCodexModel({
      configuredModel: "gpt-global-default",
      overrideModel: " ",
      sessionModel: null
    }),
    "gpt-global-default"
  );
});
