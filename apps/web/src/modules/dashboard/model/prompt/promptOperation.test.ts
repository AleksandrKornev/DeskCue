import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPromptOperation,
  isPromptOperationCurrent,
  syncPromptOperationSelection
} from "./promptOperation";

test("invalidates an old operation across an A-B-A selection cycle", () => {
  const operationRef = { current: { epoch: 0, targetSessionId: "" } };
  const selectedSessionIdRef = { current: "session-a" };
  const operation = beginPromptOperation(operationRef, "session-a");

  selectedSessionIdRef.current = "session-b";
  syncPromptOperationSelection(operationRef, "session-b");
  selectedSessionIdRef.current = "session-a";
  syncPromptOperationSelection(operationRef, "session-a");

  assert.equal(isPromptOperationCurrent(operationRef, selectedSessionIdRef, operation), false);
});
