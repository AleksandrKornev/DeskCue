import type { MutableRefObject } from "react";

export type SessionSelectionOperation = {
  epoch: number;
  targetSessionId: string;
};

export function captureSessionSelectionOperation(
  targetSessionId: string,
  selectionEpochRef: MutableRefObject<number>
): SessionSelectionOperation {
  return {
    epoch: selectionEpochRef.current,
    targetSessionId
  };
}

export function isSessionSelectionOperationCurrent(
  selectedSessionIdRef: MutableRefObject<string>,
  selectionEpochRef: MutableRefObject<number>,
  operation: SessionSelectionOperation
) {
  return selectedSessionIdRef.current === operation.targetSessionId &&
    selectionEpochRef.current === operation.epoch;
}
