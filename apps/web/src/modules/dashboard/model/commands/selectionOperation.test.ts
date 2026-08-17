import assert from "node:assert/strict";
import test from "node:test";

import {
  captureSessionSelectionOperation,
  isSessionSelectionOperationCurrent
} from "./selectionOperation";

test("rejects a selection operation after an A to B to A cycle", () => {
  const selectedSessionIdRef = { current: "session-a" };
  const selectionEpochRef = { current: 4 };
  const operation = captureSessionSelectionOperation(
    selectedSessionIdRef.current,
    selectionEpochRef
  );

  selectedSessionIdRef.current = "session-b";
  selectionEpochRef.current += 1;
  selectedSessionIdRef.current = "session-a";
  selectionEpochRef.current += 1;

  assert.equal(
    isSessionSelectionOperationCurrent(
      selectedSessionIdRef,
      selectionEpochRef,
      operation
    ),
    false
  );
});
