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
  promptRecovery,
  sendInput
}: {
  clearPendingCommand: () => void;
  promptRecovery: PromptRecoveryState | null;
  sendInput: (promptText: string) => Promise<boolean>;
}) {
  const promptText = promptRecovery?.promptText?.trim();

  if (
    !promptRecovery ||
    !promptText ||
    promptRecovery.phase !== "not_sent" ||
    !promptRecovery.retryable
  ) {
    return false;
  }

  clearPendingCommand();
  return sendInput(promptText);
}
