import type { PromptRecoveryState, SessionSummary } from "@deskcue/protocol";

export function resolveRecoveredPromptCommandTarget(
  sessionId: string,
  session: Pick<SessionSummary, "adapterId" | "canSendInput" | "sourceSessionId"> | null
) {
  if (
    session?.canSendInput === false &&
    session.adapterId === "codex" &&
    session.sourceSessionId
  ) {
    return {
      operation: "source.attach" as const,
      targetId: `codex:${session.sourceSessionId}`
    };
  }

  return {
    operation: "managed.input" as const,
    targetId: sessionId
  };
}

export async function resendRecoveredPrompt({
  clearPendingCommand,
  confirmDuplicate,
  promptRecovery,
  sendInput
}: {
  clearPendingCommand: () => void;
  confirmDuplicate: () => Promise<boolean>;
  promptRecovery: PromptRecoveryState | null;
  sendInput: (promptText: string) => Promise<boolean>;
}) {
  const promptText = promptRecovery?.promptText?.trim();
  if (!promptRecovery || !promptText || promptRecovery.phase === "checking") {
    return false;
  }

  if (promptRecovery.phase === "not_sent" && !promptRecovery.retryable) {
    return false;
  }

  if (promptRecovery.phase === "outcome_unknown") {
    const confirmed = await confirmDuplicate();
    if (!confirmed) {
      return false;
    }
  }

  clearPendingCommand();
  return sendInput(promptText);
}
