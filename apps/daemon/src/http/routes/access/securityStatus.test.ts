import assert from "node:assert/strict";
import test from "node:test";

import { classifyExposureLevel, classifyRiskLevel } from "./securityStatus.ts";

test("security status classifies loopback bind as local-only", () => {
  assert.equal(classifyExposureLevel("127.0.0.1", null), "local_only");
  assert.equal(classifyExposureLevel("localhost", null), "local_only");
  assert.equal(classifyExposureLevel("::1", null), "local_only");
});

test("security status classifies non-loopback bind as LAN exposed", () => {
  assert.equal(classifyExposureLevel("0.0.0.0", null), "lan_exposed");
  assert.equal(classifyExposureLevel("203.0.113.50", null), "lan_exposed");
});

test("security status classifies non-local public host as public exposed", () => {
  assert.equal(
    classifyExposureLevel("127.0.0.1", "https://deskcue.example.com"),
    "public_exposed"
  );
});

test("security status reports high risk only for exposed daemon without auth", () => {
  assert.equal(classifyRiskLevel("local_only", false), "medium");
  assert.equal(classifyRiskLevel("local_only", true), "low");
  assert.equal(classifyRiskLevel("lan_exposed", true), "medium");
  assert.equal(classifyRiskLevel("public_exposed", true), "medium");
  assert.equal(classifyRiskLevel("lan_exposed", false), "high");
  assert.equal(classifyRiskLevel("public_exposed", false), "high");
});
