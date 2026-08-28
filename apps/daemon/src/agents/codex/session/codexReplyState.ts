import type {
  AgentSessionDetail,
  CodexSessionDetail,
  CodexTranscriptEntry,
  ReplyState,
  SessionDetail
} from "@deskcue/protocol";
import { deriveSourceAgentTurnState } from "#agents/sourceAgentTurnState";
import { emptyReplyState } from "#sessions/model/sessionDefaults";

const CODEX_ACTIVE_TURN_STALE_MS = 2 * 60 * 1000;
const SOURCE_PROMPT_OBSERVATION_WINDOW_MS = 30_000;

function isWithinSourcePromptObservationWindow(entryTimestamp: string, requestedAt: string) {
  const entryTime = Date.parse(entryTimestamp);
  const requestedTime = Date.parse(requestedAt);

  return Number.isFinite(entryTime) && Number.isFinite(requestedTime) &&
    entryTime >= requestedTime && entryTime <= requestedTime + SOURCE_PROMPT_OBSERVATION_WINDOW_MS;
}

export function isManagedSessionOwnActiveTurn(
  session: Pick<SessionDetail, "replyState">,
  sourceSession: Pick<AgentSessionDetail | CodexSessionDetail, "transcript">
) {
  const { promptText, requestedAt } = session.replyState;

  if (!promptText || !requestedAt) return false;

  return sourceSession.transcript.some((entry) => {
    if (entry.role !== "user" || entry.text.trim() !== promptText.trim()) return false;

    return isWithinSourcePromptObservationWindow(entry.timestamp, requestedAt);
  });
}

export function getCodexAttachState(transcript: CodexTranscriptEntry[]) {
  const turnState = deriveSourceAgentTurnState({ transcript });

  if (turnState.phase !== "active") {
    return {
      mode: "resume" as const,
      reason: null,
      turnState
    };
  }

  return {
    mode: "read_only" as const,
    reason: "This Codex thread is active in another client right now.",
    turnState
  };
}

export function isReplyStateEqual(left: ReplyState, right: ReplyState) {
  return (
    left.phase === right.phase &&
    left.deliveryRequestedAt === right.deliveryRequestedAt &&
    left.promptText === right.promptText &&
    left.requestedAt === right.requestedAt &&
    left.sourcePromptObserved === right.sourcePromptObserved
  );
}

function readCodexTurnTerminalLabel(entry: CodexTranscriptEntry) {
  if (entry.role !== "system") return null;

  const statusPart = entry.parts?.find((part) => part.type === "status");

  return statusPart?.type === "status" ? statusPart.label : entry.text;
}

function findOwnedPromptTurn(
  transcript: CodexTranscriptEntry[],
  promptText: string,
  requestedAt: string
) {
  const userEntryIndex = transcript.findIndex(
    (entry) =>
      entry.role === "user" &&
      entry.text.trim() === promptText.trim() &&
      isWithinSourcePromptObservationWindow(entry.timestamp, requestedAt)
  );

  if (userEntryIndex < 0) return null;

  const userEntry = transcript[userEntryIndex];
  const followingEntries = transcript.slice(userEntryIndex + 1);
  const nextUserIndex = followingEntries.findIndex((entry) => entry.role === "user");
  const turnEntries = nextUserIndex < 0
    ? followingEntries
    : followingEntries.slice(0, nextUserIndex);

  return { turnEntries, userEntry };
}

function readOwnedPromptTerminalOutcome(turnEntries: CodexTranscriptEntry[]) {
  for (const entry of turnEntries) {
    const label = readCodexTurnTerminalLabel(entry);

    if (label === "Turn completed") return "completed" as const;
    if (label === "Turn failed") return "failed" as const;
    if (label === "Turn interrupted") return "interrupted" as const;
  }

  return null;
}

function hasFinalAssistantReply(turnEntries: CodexTranscriptEntry[]) {
  return turnEntries.some(
    (entry) =>
      entry.role === "assistant" &&
      (entry.phase === "final" || entry.phase === "final_answer")
  );
}

export function isManagedSessionOwnCompletedTurn(
  session: Pick<SessionDetail, "replyState">,
  sourceSession: Pick<AgentSessionDetail | CodexSessionDetail, "transcript">
) {
  const { promptText, requestedAt } = session.replyState;

  if (!promptText || !requestedAt) return false;

  const ownedTurn = findOwnedPromptTurn(sourceSession.transcript, promptText, requestedAt);

  if (!ownedTurn) return false;

  const terminalOutcome = readOwnedPromptTerminalOutcome(ownedTurn.turnEntries);

  if (terminalOutcome) return terminalOutcome === "completed";

  return hasFinalAssistantReply(ownedTurn.turnEntries);
}

function isActiveSourceTurn(session: Pick<AgentSessionDetail, "turnState" | "workState">) {
  return session.turnState ? session.turnState.phase === "active" : session.workState === "running";
}

function recoverManagedWaitingReplyState(
  session: Pick<SessionDetail, "inputHistory" | "replyState">,
  agentSession: AgentSessionDetail
): ReplyState {
  if (!isActiveSourceTurn(agentSession)) return session.replyState;

  const conversation = agentSession.transcript.filter(
    (entry) => entry.role === "user" || entry.role === "assistant"
  );
  const latestUserEntry = [...conversation].reverse().find((entry) => entry.role === "user");

  if (!latestUserEntry || !session.inputHistory.some(
    (input) => input.trim() === latestUserEntry.text.trim()
  )) {
    return session.replyState;
  }

  const latestUserTimestamp = new Date(latestUserEntry.timestamp).getTime();
  const hasAssistantReply = conversation.some((entry) =>
    entry.role === "assistant" &&
    new Date(entry.timestamp).getTime() >= latestUserTimestamp
  );

  if (hasAssistantReply) return session.replyState;

  return {
    phase: "waiting",
    promptText: latestUserEntry.text,
    requestedAt: latestUserEntry.timestamp
  };
}

function isStaleCodexTurn(startedAt: string, latestActivityAt: string | null) {
  const referenceTimestamp = latestActivityAt ?? startedAt;
  const referenceTime = Date.parse(referenceTimestamp);

  if (Number.isNaN(referenceTime)) return false;

  return Date.now() - referenceTime > CODEX_ACTIVE_TURN_STALE_MS;
}

function hasActiveCodexTurn(transcript: CodexTranscriptEntry[]) {
  let latestActivityTimestamp: string | null = null;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];

    if (!latestActivityTimestamp) latestActivityTimestamp = entry.timestamp;

    if (entry.role !== "system") continue;

    const statusPart = entry.parts?.find((part) => part.type === "status");
    const label = statusPart?.type === "status" ? statusPart.label : entry.text;

    if (label === "Turn completed" || label === "Turn interrupted" || label === "Turn failed") return false;
    if (label === "Turn started") return !isStaleCodexTurn(entry.timestamp, latestActivityTimestamp);
  }

  return false;
}

function hasActiveCodexTurnAfter(transcript: CodexTranscriptEntry[], timestamp: string) {
  const timestampTime = new Date(timestamp).getTime();

  if (Number.isNaN(timestampTime)) return hasActiveCodexTurn(transcript);

  let latestActivityTimestamp: string | null = null;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    const entryTime = new Date(entry.timestamp).getTime();

    if (Number.isNaN(entryTime) || entryTime < timestampTime - 15_000) continue;

    if (!latestActivityTimestamp) latestActivityTimestamp = entry.timestamp;

    if (entry.role !== "system") continue;

    const statusPart = entry.parts?.find((part) => part.type === "status");
    const label = statusPart?.type === "status" ? statusPart.label : entry.text;

    if (label === "Turn completed" || label === "Turn interrupted" || label === "Turn failed") return false;
    if (label === "Turn started") return !isStaleCodexTurn(entry.timestamp, latestActivityTimestamp);
  }

  return false;
}

export function deriveReplyStateFromAgentSession(
  session: Pick<SessionDetail, "inputHistory" | "replyState">,
  agentSession: AgentSessionDetail,
  canObserveOwnedPrompt = false
): ReplyState {
  const currentState = session.replyState;

  if (currentState.phase === "idle" || !currentState.promptText || !currentState.requestedAt) {
    return recoverManagedWaitingReplyState(session, agentSession);
  }

  if (currentState.phase === "queued") return currentState;

  const requestedAt = currentState.requestedAt;

  const ownedTurn = canObserveOwnedPrompt
    ? findOwnedPromptTurn(agentSession.transcript, currentState.promptText, requestedAt)
    : null;

  if (!ownedTurn) {
    if (hasActiveCodexTurnAfter(agentSession.transcript, requestedAt)) return currentState;

    return currentState;
  }

  const terminalOutcome = readOwnedPromptTerminalOutcome(ownedTurn.turnEntries);

  if (terminalOutcome === "completed") return emptyReplyState();
  if (!terminalOutcome && hasFinalAssistantReply(ownedTurn.turnEntries)) return emptyReplyState();

  return {
    ...(currentState.deliveryRequestedAt
      ? { deliveryRequestedAt: currentState.deliveryRequestedAt }
      : {}),
    phase: "waiting",
    promptText: currentState.promptText,
    requestedAt: ownedTurn.userEntry.timestamp,
    sourcePromptObserved: true
  };
}
