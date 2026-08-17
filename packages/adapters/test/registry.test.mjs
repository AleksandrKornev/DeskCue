import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterMetadata,
  codexAdapter,
  genericCliAdapter,
  getAdapterMetadata
} from "../dist/index.js";

test("registry exposes metadata snapshots without implementation methods", () => {
  const genericMetadata = getAdapterMetadata("generic-cli");
  const codexMetadata = getAdapterMetadata("codex");

  assert.deepEqual(genericMetadata, {
    id: "generic-cli",
    label: "Generic CLI",
    description: "Runs any local terminal command inside a workspace.",
    supportLevel: "stable",
    runtimeKind: "generic-cli",
    capabilities: { attach: false, discover: false, resume: false, start: true }
  });
  assert.equal("normalize" in genericMetadata, false);
  assert.equal("buildResumeCommand" in codexMetadata, false);
  assert.notStrictEqual(codexMetadata.capabilities, codexAdapter.capabilities);
  assert.notStrictEqual(genericMetadata.capabilities, genericCliAdapter.capabilities);
});

test("registry ids stay unique and unknown adapters remain explicit", () => {
  const ids = adapterMetadata.map((adapter) => adapter.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getAdapterMetadata("missing-adapter"), null);
  assert.equal(getAdapterMetadata("aider"), null);
  assert.equal(Object.isFrozen(adapterMetadata), true);
  assert.equal(Object.isFrozen(adapterMetadata[0]), true);
  assert.equal(Object.isFrozen(adapterMetadata[0].capabilities), true);
  assert.throws(() => adapterMetadata.push({ id: "mutated" }), TypeError);
  assert.throws(() => {
    adapterMetadata[0].capabilities.start = false;
  }, TypeError);
});

test("agent adapters preserve command construction behavior", () => {
  const command = codexAdapter.buildResumeCommand(
    "session id",
    "continue now",
    "codex",
    "gpt-test"
  );

  assert.match(command, /check_for_update_on_startup=false/);
  assert.match(command, /resume/);
  assert.match(command, /session id/);
  assert.match(command, /continue now/);
});
