import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardCacheKey } from "./storage";

test("scopes the dashboard cache by runtime connection identity", () => {
  assert.notEqual(
    buildDashboardCacheKey("local:http://daemon-a:4100:device-1"),
    buildDashboardCacheKey("local:http://daemon-b:4100:device-1")
  );
  assert.notEqual(
    buildDashboardCacheKey("local:http://daemon-a:4100:device-1"),
    buildDashboardCacheKey("local:http://daemon-a:4100:device-2")
  );
});
