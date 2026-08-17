import assert from "node:assert/strict";
import test from "node:test";

import { readRouteSessionId, readRouteSessionTab } from "./helpers";

test("reads the session tab directly from a session route", () => {
  assert.equal(readRouteSessionTab("/sessions/session-1/diff"), "diff");
  assert.equal(readRouteSessionTab("/sessions/session-1/files"), "files");
  assert.equal(readRouteSessionTab("/sessions/session-1/preview"), "preview");
});

test("falls back to the chat tab outside a valid session tab route", () => {
  assert.equal(readRouteSessionTab("/"), "overview");
  assert.equal(readRouteSessionTab("/sessions/session-1/unknown"), "overview");
});

test("keeps reading encoded session identifiers independently from the tab", () => {
  assert.equal(readRouteSessionId("/sessions/session%20one/files"), "session one");
});
