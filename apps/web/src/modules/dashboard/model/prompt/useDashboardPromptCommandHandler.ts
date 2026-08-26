import type { SendInputOptions } from "@models/promptDelivery";

import {
  executePromptCommand,
  resolvePromptCommandTarget
} from "./command/promptCommandExecution";
import { resolveShouldReplaceRunningPrompt } from "./command/promptReplacementPreflight";
import { beginPromptOperation, isPromptOperationCurrent } from "./promptOperation";
import type { UseDashboardPromptCommandHandlerArgs } from "./types";

export function useDashboardPromptCommandHandler(args: UseDashboardPromptCommandHandlerArgs) {
  const {
    promptDelivery,
    promptOperationRef,
    selectedSessionId,
    selectedSessionIdRef,
    setError
  } = args;

  return async function handleSendInput(
    nextInstruction: string,
    options?: SendInputOptions
  ): Promise<string | false> {
    const normalizedInstruction = nextInstruction.trim();

    if (!selectedSessionId || !normalizedInstruction) return false;

    const operation = beginPromptOperation(promptOperationRef, selectedSessionId);
    const operationState = {
      isCurrent() {
        return isPromptOperationCurrent(promptOperationRef, selectedSessionIdRef, operation);
      }
    };

    setError("");

    const target = resolvePromptCommandTarget(args);

    const shouldReplaceRunningPrompt = await resolveShouldReplaceRunningPrompt({
      actionDecisionProvided: Boolean(options?.actionDecision),
      adapterId: target.adapterId,
      managedSessionStatus: args.selectedSession?.status ?? null,
      replacementRequested: Boolean(options?.replaceRunningPrompt),
      sourceSessionId: target.sourceSessionId
    });

    if (!operationState.isCurrent()) return false;

    if (shouldReplaceRunningPrompt) {
      const interrupted =
        await promptDelivery.interruptPromptBeforeSendingReplacement(selectedSessionId, operation);

      if (!interrupted || !operationState.isCurrent()) return false;
    } else {
      promptDelivery.setIsInterruptingPrompt(false);
    }

    return executePromptCommand({
      ...args,
      normalizedInstruction,
      operationIsCurrent: operationState.isCurrent,
      options,
      retry: handleSendInput,
      target
    });
  };
}
