import type {
  AgentSessionDetail,
  CodexSessionDetail,
  CodexTranscriptEntry,
  ReplyState,
  SessionDetail
} from "@deskcue/protocol";
import { deriveSourceAgentTurnState } from "#agents/sourceAgentTurnState";
import { emptyReplyState } from "#sessions/model/sessionDefaults";

const CODEX_INPUT_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;
const CODEX_ACTIVE_TURN_STALE_MS = 2 * 60 * 1000;
const MANAGED_CODEX_INPUT_SENT_LOGS = new Set([
  "Input sent.\n",
  "Initial input sent.\n"
]);

export function isManagedSessionOwnActiveTurn(
  session: Pick<SessionDetail, "replyState">,
  sourceSession: Pick<AgentSessionDetail | CodexSessionDetail, "transcript">
) {
  const { promptText, requestedAt } = session.replyState;

  if (!promptText || !requestedAt) return false;

  const requestedAtTime = new Date(requestedAt).getTime();

  return sourceSession.transcript.some((entry) => {
    if (entry.role !== "user" || entry.text.trim() !== promptText.trim()) return false;

    return new Date(entry.timestamp).getTime() >= requestedAtTime - 15_000;
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
    left.promptText === right.promptText &&
    left.requestedAt === right.requestedAt
  );
}

function readCodexTurnTerminalLabel(entry: CodexTranscriptEntry) {
  if (entry.role !== "system") return null;

  const statusPart = entry.parts?.find((part) => part.type === "status");

  return statusPart?.type === "status" ? statusPart.label : entry.text;
}

function isTerminalCodexTurnEntry(entry: CodexTranscriptEntry) {
  const label = readCodexTurnTerminalLabel(entry);

  return label === "Turn completed" || label === "Turn interrupted" || label === "Turn failed";
}

export function isLatestManagedCodexPromptConfirmedComplete(
  session: Pick<SessionDetail, "inputHistory" | "logs">,
  sourceSession: Pick<AgentSessionDetail | CodexSessionDetail, "transcript">
) {
  const prompt = session.inputHistory.at(-1)?.trim();
  let inputLog: SessionDetail["logs"][number] | undefined;

  for (let index = session.logs.length - 1; index >= 0; index -= 1) {
    const log = session.logs[index];

    if (!MANAGED_CODEX_INPUT_SENT_LOGS.has(log.text)) continue;

    inputLog = log;
    break;
  }

  if (!prompt || !inputLog) return false;

  const requestedAt = Date.parse(inputLog.timestamp);

  if (!Number.isFinite(requestedAt)) return false;

  let matchingPromptIndex = -1;

  for (let index = sourceSession.transcript.length - 1; index >= 0; index -= 1) {
    const entry = sourceSession.transcript[index];

    if (
      entry.role === "user" &&
      entry.text.trim() === prompt &&
      Date.parse(entry.timestamp) >= requestedAt - 15_000
    ) {
      matchingPromptIndex = index;
      break;
    }
  }

  if (matchingPromptIndex < 0) return false;

  for (let index = matchingPromptIndex + 1; index < sourceSession.transcript.length; index += 1) {
    const entry = sourceSession.transcript[index];

    if (entry.role === "user") return false;

    const terminalLabel = readCodexTurnTerminalLabel(entry);

    if (terminalLabel === "Turn completed") return true;
    if (terminalLabel === "Turn interrupted" || terminalLabel === "Turn failed") return false;
  }

  return false;
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
  agentSession: AgentSessionDetail
): ReplyState {
  const currentState = session.replyState;

  if (currentState.phase === "idle" || !currentState.promptText || !currentState.requestedAt) {
    return recoverManagedWaitingReplyState(session, agentSession);
  }

  if (currentState.phase === "queued") return currentState;

  const requestedAt = currentState.requestedAt;

  const conversation = agentSession.transcript.filter(
    (entry) => entry.role === "user" || entry.role === "assistant"
  );

  const matchingUserEntry = [...conversation]
    .reverse()
    .find(
      (entry) =>
        entry.role === "user" &&
        entry.text.trim() === currentState.promptText &&
        new Date(entry.timestamp).getTime() >= new Date(requestedAt).getTime() - 15_000
    );

  const latestAssistantAfterPrompt = [...conversation]
    .reverse()
    .find(
      (entry) =>
        entry.role === "assistant" &&
        new Date(entry.timestamp).getTime() >=
          new Date(matchingUserEntry?.timestamp ?? requestedAt).getTime()
    );

  const latestTurnFinishedAfterPrompt = [...agentSession.transcript]
    .reverse()
    .find((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      const promptTime = new Date(matchingUserEntry?.timestamp ?? requestedAt).getTime();

      return entryTime >= promptTime && isTerminalCodexTurnEntry(entry);
    });

  if (latestAssistantAfterPrompt || latestTurnFinishedAfterPrompt) return emptyReplyState();

  if (!matchingUserEntry) {
    if (hasActiveCodexTurnAfter(agentSession.transcript, requestedAt)) return currentState;

    if (
      currentState.phase === "sending" &&
      Date.now() - new Date(requestedAt).getTime() > CODEX_INPUT_CONFIRMATION_TIMEOUT_MS
    ) {
      return emptyReplyState();
    }

    return currentState;
  }

  return {
    phase: "waiting",
    promptText: currentState.promptText,
    requestedAt: matchingUserEntry.timestamp
  };
}
