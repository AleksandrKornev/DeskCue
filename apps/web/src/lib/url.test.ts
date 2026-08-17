import assert from "node:assert/strict";
import test from "node:test";

import { safelyDecodeUriComponent } from "./url";

test("decodes valid route segments", () => {
  assert.equal(safelyDecodeUriComponent("chat%20one"), "chat one");
});

test("rejects malformed route segments without throwing", () => {
  assert.equal(safelyDecodeUriComponent("%E0%A4%A"), null);
});
