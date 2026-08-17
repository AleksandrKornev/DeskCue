import type { AgentSessionDetail } from "@deskcue/protocol";

export interface PendingChatPrompt {
  text: string;
  requestedAt: string;
  status?: "cancelled" | "queued" | "sending" | "starting" | "waiting" | "not_confirmed";
  sessionId?: string;
  sourceSessionId?: string;
}

export type SendInputOptions = {
  actionDecision?: "approve" | "reject";
  replaceRunningPrompt?: boolean;
};

function isTerminalTurnEntry(entry: AgentSessionDetail["transcript"][number]) {
  if (entry.role !== "system") {
    return false;
  }

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;

  return label === "Turn completed" || label === "Turn interrupted";
}

function findPromptUserTimestamp(
  agentSession: Pick<AgentSessionDetail, "transcript"> | null,
  prompt: PendingChatPrompt
) {
  if (!agentSession) {
    return null;
  }

  const requestedAt = new Date(prompt.requestedAt).getTime();
  const promptText = prompt.text.trim();
  let matchingUserTime: number | null = null;

  for (const entry of agentSession.transcript) {
    if (entry.role !== "user" || entry.text.trim() !== promptText) {
      continue;
    }

    const entryTime = new Date(entry.timestamp).getTime();
    if (entryTime >= requestedAt - 15_000) {
      matchingUserTime = entryTime;
    }
  }

  return matchingUserTime;
}

function hasTerminalTurnStateAfterPrompt(
  agentSession: Pick<AgentSessionDetail, "turnState">,
  prompt: PendingChatPrompt
) {
  const turnState = agentSession.turnState;
  if (
    !turnState?.completedAt ||
    (turnState.phase !== "completed" &&
      turnState.phase !== "failed" &&
      turnState.phase !== "interrupted")
  ) {
    return false;
  }

  const requestedAt = Date.parse(prompt.requestedAt);
  const completedAt = Date.parse(turnState.completedAt);
  return Number.isFinite(requestedAt) &&
    Number.isFinite(completedAt) &&
    completedAt >= requestedAt - 15_000;
}

export function hasPromptCompletionInTranscript(
  agentSession: Pick<AgentSessionDetail, "transcript" | "turnState"> | null,
  prompt: PendingChatPrompt
) {
  if (!agentSession) {
    return false;
  }

  const matchingUserTime = findPromptUserTimestamp(agentSession, prompt);
  if (matchingUserTime === null) {
    return hasTerminalTurnStateAfterPrompt(agentSession, prompt);
  }

  return agentSession.transcript.some((entry) => {
    const entryTime = new Date(entry.timestamp).getTime();
    return entryTime >= matchingUserTime && (entry.role === "assistant" || isTerminalTurnEntry(entry));
  });
}

export function hasPromptConfirmationInTranscript(
  agentSession: Pick<AgentSessionDetail, "transcript"> | null,
  prompt: PendingChatPrompt
) {
  return findPromptUserTimestamp(agentSession, prompt) !== null;
}
