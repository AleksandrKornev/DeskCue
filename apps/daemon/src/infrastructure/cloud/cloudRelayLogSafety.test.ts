import assert from "node:assert/strict";
import test from "node:test";

import { toSafeCloudRelayCloseReasonCode } from "./cloudRelayLogSafety.ts";

test("Cloud relay close logging never derives a field from remote plaintext", () => {
  const privateReason = Buffer.from("private prompt plaintext", "utf8");
  const code = toSafeCloudRelayCloseReasonCode(privateReason);
  assert.equal(code, "remote_reason_redacted");
  assert.equal(code.includes("private"), false);
  assert.equal(toSafeCloudRelayCloseReasonCode(Buffer.alloc(0)), "unreported");
});
