import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAgentAttachOperation,
  isAgentAttachOperationCurrent,
  syncAgentAttachOperationSelection
} from "./agentAttachOperation";

test("invalidates an old attach response across an A-B-A selection cycle", () => {
  const operationRef = { current: { epoch: 0, targetSessionId: "" } };
  const selectedAgentSessionIdRef = { current: "agent-a" };
  const operation = beginAgentAttachOperation(operationRef, "agent-a");

  selectedAgentSessionIdRef.current = "agent-b";
  syncAgentAttachOperationSelection(operationRef, "agent-b");
  selectedAgentSessionIdRef.current = "agent-a";
  syncAgentAttachOperationSelection(operationRef, "agent-a");

  assert.equal(
    isAgentAttachOperationCurrent(operationRef, selectedAgentSessionIdRef, operation),
    false
  );
});
