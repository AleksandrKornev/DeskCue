import type { MutableRefObject } from "react";

import type { PromptOperationState } from "@modules/dashboard/model/commands/types";

export function beginPromptOperation(
  promptOperationRef: MutableRefObject<PromptOperationState>,
  targetSessionId: string
) {
  const operation = {
    epoch: promptOperationRef.current.epoch + 1,
    targetSessionId
  };
  promptOperationRef.current = operation;
  return operation;
}

export function isPromptOperationCurrent(
  promptOperationRef: MutableRefObject<PromptOperationState>,
  selectedSessionIdRef: MutableRefObject<string>,
  operation: PromptOperationState
) {
  return (
    promptOperationRef.current.epoch === operation.epoch &&
    promptOperationRef.current.targetSessionId === operation.targetSessionId &&
    selectedSessionIdRef.current === operation.targetSessionId
  );
}

export function syncPromptOperationSelection(
  promptOperationRef: MutableRefObject<PromptOperationState>,
  selectedSessionId: string
) {
  if (promptOperationRef.current.targetSessionId === selectedSessionId) {
    return;
  }
  promptOperationRef.current = {
    epoch: promptOperationRef.current.epoch + 1,
    targetSessionId: selectedSessionId
  };
}
