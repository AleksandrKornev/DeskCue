import type { MutableRefObject } from "react";

import type { AgentAttachOperationState } from "./types";

export function beginAgentAttachOperation(
  operationRef: MutableRefObject<AgentAttachOperationState>,
  targetSessionId: string
) {
  const operation = {
    epoch: operationRef.current.epoch + 1,
    targetSessionId
  };
  operationRef.current = operation;
  return operation;
}

export function isAgentAttachOperationCurrent(
  operationRef: MutableRefObject<AgentAttachOperationState>,
  selectedAgentSessionIdRef: MutableRefObject<string>,
  operation: AgentAttachOperationState
) {
  return (
    operationRef.current.epoch === operation.epoch &&
    operationRef.current.targetSessionId === operation.targetSessionId &&
    selectedAgentSessionIdRef.current === operation.targetSessionId
  );
}

export function syncAgentAttachOperationSelection(
  operationRef: MutableRefObject<AgentAttachOperationState>,
  selectedAgentSessionId: string
) {
  if (operationRef.current.targetSessionId === selectedAgentSessionId) {
    return;
  }
  operationRef.current = {
    epoch: operationRef.current.epoch + 1,
    targetSessionId: selectedAgentSessionId
  };
}
